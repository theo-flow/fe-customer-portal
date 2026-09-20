import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import { S3Client } from '@aws-sdk/client-s3'
import { SQSClient } from '@aws-sdk/client-sqs'
import { EventBridgeClient } from '@aws-sdk/client-eventbridge'
import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider'
import { fromIni } from '@aws-sdk/credential-providers'

const REGION = process.env.AWS_REGION ?? 'af-south-1'

// Local dev: use the named SSO profile.
// Lambda/Amplify: AWS_PROFILE is not set — SDK uses the execution role automatically.
function credentials() {
  const profile = process.env.AWS_PROFILE
  return profile ? fromIni({ profile }) : undefined
}

export function ddbDocClient() {
  return DynamoDBDocumentClient.from(
    new DynamoDBClient({ region: REGION, credentials: credentials() })
  )
}

export function s3Client() {
  return new S3Client({ region: REGION, credentials: credentials() })
}

export function sqsClient() {
  return new SQSClient({ region: REGION, credentials: credentials() })
}

export function eventBridgeClient() {
  return new EventBridgeClient({ region: REGION, credentials: credentials() })
}

export function cognitoClient() {
  return new CognitoIdentityProviderClient({ region: REGION, credentials: credentials() })
}

export const USER_POOL_ID = process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID ?? ''

export const TABLE         = process.env.DYNAMODB_TABLE_ORGS    ?? 'daai-insure-orgs'
export const BUCKET        = process.env.S3_INTAKE_BUCKET       ?? 'daai-insure-intake'
export const OUTPUT_BUCKET = process.env.S3_OUTPUT_BUCKET       ?? 'daai-insure-output'
export const CONTACT_TABLE = process.env.DYNAMODB_TABLE_CONTACT ?? 'daai-insure-contact-messages'

// Gate-Keep archive: bytes in a dedicated versioned bucket, folders and file
// metadata in their own catalogue table (infrastructure/terraform/gate-keep).
// Defaults are the real names, so no Lambda environment change is needed.
export const GATE_KEEP_BUCKET = process.env.S3_GATE_KEEP_BUCKET     ?? 'theoflow-gate-keep-archive'
export const GATE_KEEP_TABLE  = process.env.DYNAMODB_TABLE_GATE_KEEP ?? 'daai-insure-gate-keep'
