import * as cdk from 'aws-cdk-lib';
import {
  AlbControllerVersion,
  CapacityType,
  CfnAddon,
  Cluster,
  KubernetesVersion,
  NodegroupAmiType,
  TaintEffect,
} from 'aws-cdk-lib/aws-eks';
import { Construct } from 'constructs';
import { KubectlV35Layer } from '@aws-cdk/lambda-layer-kubectl-v35';
import { InstanceType } from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import { User } from 'aws-cdk-lib/aws-iam';

// import * as sqs from 'aws-cdk-lib/aws-sqs';

export class MessengerStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const cluster = new Cluster(this, 'MessengerCluster', {
      version: KubernetesVersion.V1_35,
      kubectlLayer: new KubectlV35Layer(this, 'kubectl'),
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      // We need the ALB controller to support the Ingress.
      albController: {
        version: AlbControllerVersion.V3_2_2,
      },
      defaultCapacity: 0, // The capacity is defined later.
    });

    const nodegroupCommon = {
      diskSize: 20, // Minimum for AL2023.
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      amiType: NodegroupAmiType.AL2023_ARM_64_STANDARD,
    };

    // Stateful workloads (Kafka, MongoDB, Tempo, …). Spot-tainted nodes reject pods
    // without the matching toleration, so existing services stay here by default.
    // Keep construct id 'MessengerNodegroup' so CDK does not replace the existing ASG.
    cluster.addNodegroupCapacity('MessengerNodegroup', {
      ...nodegroupCommon,
      instanceTypes: [new InstanceType('t4g.large')],
      minSize: 1,
      maxSize: 6,
      capacityType: CapacityType.ON_DEMAND,
    });

    // Stateless app tiers (public-api first; more services migrate here gradually).
    // Taint keeps spot nodes exclusive to workloads that opt in via toleration + affinity.
    cluster.addNodegroupCapacity('MessengerSpotNodegroup', {
      ...nodegroupCommon,
      instanceTypes: [
        new InstanceType('t4g.large'),
        new InstanceType('t4g.xlarge'),
        new InstanceType('m7g.large'),
        new InstanceType('m6g.large'),
      ],
      minSize: 0,
      maxSize: 4,
      capacityType: CapacityType.SPOT,
      taints: [
        {
          // Only pods with 'capacity-type: spot' can be scheduled on spot nodes.
          key: 'capacity-type',
          value: 'spot',
          effect: TaintEffect.NO_SCHEDULE,
        },
      ],
    });

    cluster.awsAuth.addUserMapping(
      User.fromUserArn(
        this,
        'RafaCli',
        'arn:aws:iam::906876370565:user/rafa-cli', // [TODO] Do not hardcode.
      ),
      { username: 'rafa-cli', groups: ['system:masters'] },
    );

    this.addEbsCsiDriverWithDefaultStorageClass(cluster);
    this.addClusterAutoscaler(cluster);
  }

  /**
   * Cluster Autoscaler: IRSA (kube-system/cluster-autoscaler) + Helm release.
   * EKS tags the managed node group's ASG for auto-discovery on create.
   */
  private addClusterAutoscaler(cluster: Cluster): void {
    const clusterAutoscaler = cluster.addServiceAccount('ClusterAutoscaler', {
      name: 'cluster-autoscaler',
      namespace: 'kube-system',
      labels: {
        'k8s-addon': 'cluster-autoscaler.addons.k8s.io',
        'k8s-app': 'cluster-autoscaler',
      },
    });

    // Read AWS / EKS state: discover ASGs, instance types, scheduling pressure, etc.
    clusterAutoscaler.addToPrincipalPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'autoscaling:DescribeAutoScalingGroups',
          'autoscaling:DescribeAutoScalingInstances',
          'autoscaling:DescribeLaunchConfigurations',
          'autoscaling:DescribeScalingActivities',
          'autoscaling:DescribeTags',
          'ec2:DescribeImages',
          'ec2:DescribeInstanceTypes',
          'ec2:DescribeLaunchTemplateVersions',
          'ec2:GetInstanceTypesFromInstanceRequirements',
          'eks:DescribeNodegroup',
        ],
        resources: ['*'],
      }),
    );

    // Scale only ASGs tagged for this cluster (see EKS managed node group ASG tags).
    const clusterAutoscalerScaleCondition = new cdk.CfnJson(
      this,
      'ClusterAutoscalerScaleCondition',
      {
        value: {
          [`aws:ResourceTag/k8s.io/cluster-autoscaler/${cluster.clusterName}`]:
            'owned',
        },
      },
    );

    const scaleStatement = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'autoscaling:SetDesiredCapacity',
        'autoscaling:TerminateInstanceInAutoScalingGroup',
      ],
      resources: ['*'],
    });
    scaleStatement.addCondition(
      'StringEquals',
      clusterAutoscalerScaleCondition,
    );
    clusterAutoscaler.addToPrincipalPolicy(scaleStatement);

    const chart = cluster.addHelmChart('ClusterAutoscalerChart', {
      chart: 'cluster-autoscaler',
      repository: 'https://kubernetes.github.io/autoscaler',
      namespace: 'kube-system',
      release: 'cluster-autoscaler',
      // Chart 9.46.6 ships cluster-autoscaler v1.32.0 (match KubernetesVersion.V1_32).
      version: '9.46.6',
      createNamespace: false,
      wait: true,
      timeout: cdk.Duration.minutes(5),
      values: {
        autoDiscovery: {
          clusterName: cluster.clusterName,
        },
        awsRegion: this.region,
        rbac: {
          serviceAccount: {
            create: false,
            name: 'cluster-autoscaler',
          },
        },
        extraArgs: {
          'balance-similar-node-groups': 'true',
          'skip-nodes-with-system-pods': 'false',
        },
      },
    });
    chart.node.addDependency(clusterAutoscaler);
  }

  /**
   * Cluster storage for PersistentVolumeClaims: EBS CSI driver (addon + IAM) and a default gp3 StorageClass.
   * PVCs in k8s/base rely on a default StorageClass; EKS 1.30+ does not create one automatically.
   */
  private addEbsCsiDriverWithDefaultStorageClass(cluster: Cluster): void {
    const saNamespace = 'kube-system';
    const saName = 'ebs-csi-controller-sa';

    // The aws-ebs-csi-driver addon creates this ServiceAccount in kube-system. We only create
    // the IAM role (IRSA) and pass its ARN to the addon — not cluster.addServiceAccount, which
    // would kubectl-apply the same SA and fail with AlreadyExists.
    const irsaCondition = new cdk.CfnJson(this, 'EbsCsiDriverIrsaCondition', {
      value: {
        [`${cluster.clusterOpenIdConnectIssuer}:sub`]: `system:serviceaccount:${saNamespace}:${saName}`,
        [`${cluster.clusterOpenIdConnectIssuer}:aud`]: 'sts.amazonaws.com',
      },
    });
    const ebsCsiDriverRole = new iam.Role(this, 'EbsCsiDriverRole', {
      assumedBy: new iam.FederatedPrincipal(
        cluster.openIdConnectProvider.openIdConnectProviderArn,
        {
          StringEquals: irsaCondition,
        },
        'sts:AssumeRoleWithWebIdentity',
      ),
    });
    // Lets the CSI controller pod call AWS APIs to create, attach, and delete EBS volumes for PVCs.
    ebsCsiDriverRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonEBSCSIDriverPolicy'),
    );

    const ebsCsiAddon = new CfnAddon(this, 'EbsCsiDriverAddon', {
      clusterName: cluster.clusterName,
      addonName: 'aws-ebs-csi-driver',
      serviceAccountRoleArn: ebsCsiDriverRole.roleArn,
      resolveConflicts: 'OVERWRITE',
    });

    // Defined here (not in k8s/) because it is cluster bootstrap tied to the CSI addon and IAM above;
    // app manifests under k8s/ assume this default StorageClass already exists after cdk deploy.
    const gp3StorageClass = cluster.addManifest('Gp3DefaultStorageClass', {
      apiVersion: 'storage.k8s.io/v1',
      kind: 'StorageClass',
      metadata: {
        name: 'gp3',
        annotations: {
          'storageclass.kubernetes.io/is-default-class': 'true',
        },
      },
      provisioner: 'ebs.csi.aws.com',
      // Delay volume creation until a pod is scheduled; zonal provisioners (EBS) then create the disk in that node's AZ.
      volumeBindingMode: 'WaitForFirstConsumer',
      allowVolumeExpansion: true,
      parameters: {
        type: 'gp3',
        fsType: 'ext4',
        encrypted: 'true',
      },
    });
    // Apply StorageClass only after the addon exists (CloudFormation deploy order).
    gp3StorageClass.node.addDependency(ebsCsiAddon);
  }
}
