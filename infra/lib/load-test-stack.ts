import * as path from 'node:path';
import { Construct } from 'constructs';
import { CfnOutput, Duration, Stack, StackProps } from 'aws-cdk-lib';
import { Architecture, Function, Runtime, Code } from 'aws-cdk-lib/aws-lambda';

export interface LoadTestStackProps extends StackProps {
  /**
   * Public API base URL the Lambda will call (no trailing slash).
   * @default http://api.messenger.rgonzalez.xyz
   */
  readonly apiBaseUrl?: string;
  /**
   * Shared password for load-test users (user{N}).
   * @default load-test-password
   */
  readonly loadTestPassword?: string;
  /**
   * Soft barrier after register, in milliseconds.
   * @default 20000
   */
  readonly registerWaitMs?: number;
  /**
   * Skip POST /users (assume load-test users already exist).
   * @default true
   */
  readonly skipUserCreation?: boolean;
}

/**
 * Lambda that runs scripts/load-test/simulate-user.mjs for one virtual user.
 *
 * Invoke with a JSON payload, for example:
 *   { "uid": 42, "users": 100, "startAt": "2026-07-16T20:00:00Z" }
 */
export class LoadTestStack extends Stack {
  public readonly simulateUserFn: Function;

  constructor(scope: Construct, id: string, props: LoadTestStackProps = {}) {
    super(scope, id, props);

    const apiBaseUrl = props.apiBaseUrl ?? 'http://api.messenger.rgonzalez.xyz';
    const loadTestPassword = props.loadTestPassword ?? 'load-test-password';
    const registerWaitMs = props.registerWaitMs ?? 20_000;
    const skipUserCreation = props.skipUserCreation ?? true;

    this.simulateUserFn = new Function(this, 'SimulateUserFn', {
      functionName: 'messenger-load-test-simulate-user',
      description: 'Simulates one messenger user for load testing (register, chats, messages).',
      runtime: Runtime.NODEJS_20_X,
      architecture: Architecture.ARM_64,
      handler: 'simulate-user.handler',
      code: Code.fromAsset(('./load-test')),
      // Long enough for startAt hold + register barrier + API work (Lambda max is 15m).
      timeout: Duration.minutes(5),
      memorySize: 256,
      environment: {
        API_BASE_URL: apiBaseUrl,
        LOAD_TEST_PASSWORD: loadTestPassword,
        REGISTER_WAIT_MS: String(registerWaitMs),
        SKIP_USER_CREATION: String(skipUserCreation),
      },
    });

    new CfnOutput(this, 'SimulateUserFunctionName', {
      value: this.simulateUserFn.functionName,
    });

    new CfnOutput(this, 'SimulateUserFunctionArn', {
      value: this.simulateUserFn.functionArn,
    });
  }
}
