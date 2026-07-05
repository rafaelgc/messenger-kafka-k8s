import * as cdk from 'aws-cdk-lib';
import { Cluster, KubernetesVersion } from 'aws-cdk-lib/aws-eks';
import { Construct } from 'constructs';
import { KubectlV35Layer } from '@aws-cdk/lambda-layer-kubectl-v35';

// import * as sqs from 'aws-cdk-lib/aws-sqs';

export class MessengerStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // The code that defines your stack goes here

    // example resource
    // const queue = new sqs.Queue(this, 'CdkQueue', {
    //   visibilityTimeout: cdk.Duration.seconds(300)
    // });

    const cluster = new Cluster(this, 'MessengerCluster', {
      version: KubernetesVersion.V1_32,
      kubectlLayer: new KubectlV35Layer(this, 'kubectl'),
    });
  }
}
