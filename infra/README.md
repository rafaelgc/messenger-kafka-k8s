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

   Each user also needs **IAM permissions** on the AWS side (`eks:DescribeCluster`, `eks:ListClusters`, `eks:AccessKubernetesApi`, or managed policy `AmazonEKSClusterAdminPolicy`). CDK does not attach those — see the root [README](../README.md) (Step 2, *Requirements for each listed IAM user*).

`cdk.context.json` is gitignored. CDK loads it automatically next to `cdk.json`.

## Load test Lambda

`MessengerLoadTestStack` packages `scripts/load-test/simulate-user.mjs` as a Node.js 20 (arm64) Lambda.

Deploy only that stack:

```bash
npx cdk deploy MessengerLoadTestStack
```

Invoke one virtual user:

```bash
aws lambda invoke \
  --function-name messenger-load-test-simulate-user \
  --cli-binary-format raw-in-base64-out \
  --payload '{"uid":0,"users":10,"startAt":"2026-07-16T20:00:00Z"}' \
  /tmp/out.json && cat /tmp/out.json
```

Default env: `API_BASE_URL=http://api.messenger.rgonzalez.xyz`, timeout 15 minutes (covers `startAt` hold).

## Useful commands

* `npm run build`   compile typescript to js
* `npm run watch`   watch for changes and compile
* `npm run test`    perform the jest unit tests
* `npx cdk deploy`  deploy this stack to your default AWS account/region
* `npx cdk diff`    compare deployed stack with current state
* `npx cdk synth`   emits the synthesized CloudFormation template
