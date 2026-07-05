import * as cdk from 'aws-cdk-lib';
import { AlbControllerVersion, CapacityType, Cluster, KubernetesVersion } from 'aws-cdk-lib/aws-eks';
import { Construct } from 'constructs';
import { KubectlV35Layer } from '@aws-cdk/lambda-layer-kubectl-v35';
import { FargateCluster } from 'aws-cdk-lib/aws-eks-v2';
import { InstanceType } from 'aws-cdk-lib/aws-ec2';

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
      instanceTypes: [new InstanceType('m5.large')],
      minSize: 2,
      maxSize: 4,
      diskSize: 5,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      capacityType: CapacityType.ON_DEMAND, // [IMPROVE] Consider using SPOT for stateless services.
    });
  }
}
