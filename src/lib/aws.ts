import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import { S3Client } from '@aws-sdk/client-s3'
import { SQSClient } from '@aws-sdk/client-sqs'
import { EventBridgeClient } from '@aws-sdk/client-eventbridge'
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

export const TABLE         = process.env.DYNAMODB_TABLE_ORGS    ?? 'daai-insure-orgs'
export const BUCKET        = process.env.S3_INTAKE_BUCKET       ?? 'daai-insure-intake'
// TheoFlow Sign keeps its documents in its own bucket (platform repo,
// infrastructure/terraform/sign-storage), never in the shared intake bucket.
export const SIGN_BUCKET   = process.env.S3_SIGN_BUCKET         ?? 'daai-insure-sign'
export const OUTPUT_BUCKET = process.env.S3_OUTPUT_BUCKET       ?? 'daai-insure-output'
export const CONTACT_TABLE = process.env.DYNAMODB_TABLE_CONTACT ?? 'daai-insure-contact-messages'
