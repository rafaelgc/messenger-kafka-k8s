# Messenger CDK (EKS)

The `cdk.json` file tells the CDK Toolkit how to execute your app.

## Account-specific config (EKS admin access)

IAM users allowed to administer the cluster are **not** hardcoded in the stack. They live in CDK **context**:

1. Copy the example file:

   ```bash
   cp cdk.context.example.json cdk.context.json
   ```

2. Edit `cdk.context.json` and set your IAM user ARNs:

   ```json
   {
     "messenger": {
       "eksAdminUserArns": [
         "arn:aws:iam::906876370565:user/rafa-cli"
       ]
     }
   }
   ```

   Kubernetes username is derived from the last segment of each ARN (`rafa-cli`). All listed users are mapped to `system:masters`.

`cdk.context.json` is gitignored. CDK loads it automatically next to `cdk.json`.

## Useful commands

* `npm run build`   compile typescript to js
* `npm run watch`   watch for changes and compile
* `npm run test`    perform the jest unit tests
* `npx cdk deploy`  deploy this stack to your default AWS account/region
* `npx cdk diff`    compare deployed stack with current state
* `npx cdk synth`   emits the synthesized CloudFormation template
