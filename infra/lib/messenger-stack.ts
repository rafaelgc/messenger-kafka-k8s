import * as cdk from 'aws-cdk-lib';
import {
  AlbControllerVersion,
  CapacityType,
  CfnAddon,
  Cluster,
  KubernetesVersion,
  NodegroupAmiType,
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
      version: KubernetesVersion.V1_32,
      kubectlLayer: new KubectlV35Layer(this, 'kubectl'),
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      // We need the ALB controller to support the Ingress.
      albController: {
        version: AlbControllerVersion.V3_2_2,
      },
      defaultCapacity: 0, // The capacity is defined later.
    });

    cluster.addNodegroupCapacity('MessengerNodegroup', {
      instanceTypes: [new InstanceType('t4g.large')], // m5.large
      minSize: 1,
      maxSize: 4,
      diskSize: 20, // Minimum for AL2023.
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      // [IMPROVE] Consider using SPOT for stateless services and
      // ON_DEMAND for stateful services (database).
      capacityType: CapacityType.ON_DEMAND,
      amiType: NodegroupAmiType.AL2023_ARM_64_STANDARD,
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
