import * as cdk from 'aws-cdk-lib';

/** Account-specific values from CDK context (see cdk.context.example.json). */
export interface MessengerContext {
  /** IAM user ARNs mapped to system:masters in the EKS aws-auth ConfigMap. */
  readonly eksAdminUserArns: string[];
}

/** Last path segment of an IAM user ARN (Kubernetes username). */
export function iamUserNameFromArn(arn: string): string {
  const name = arn.split('/').pop();
  if (!name) {
    throw new Error(`Cannot derive IAM user name from ARN: ${arn}`);
  }
  return name;
}

export function loadMessengerContext(app: cdk.App): MessengerContext {
  const messenger = app.node.tryGetContext('messenger') as MessengerContext | undefined;
  if (!messenger) {
    throw new Error(
      'Missing CDK context key "messenger". Copy cdk.context.example.json to cdk.context.json and set eksAdminUserArns.',
    );
  }

  if (!messenger.eksAdminUserArns?.length) {
    throw new Error('CDK context "messenger.eksAdminUserArns" must include at least one IAM user ARN.');
  }

  return messenger;
}
