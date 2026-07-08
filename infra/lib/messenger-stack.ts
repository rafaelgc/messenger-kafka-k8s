import * as cdk from 'aws-cdk-lib';
import { AlbControllerVersion, CapacityType, Cluster, KubernetesVersion, NodegroupAmiType } from 'aws-cdk-lib/aws-eks';
import { Construct } from 'constructs';
import { KubectlV35Layer } from '@aws-cdk/lambda-layer-kubectl-v35';
import { FargateCluster } from 'aws-cdk-lib/aws-eks-v2';
import { InstanceType } from 'aws-cdk-lib/aws-ec2';
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
      capacityType: CapacityType.SPOT,
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
  }
}
