import { CognitoIdentityClient, GetIdCommand, GetCredentialsForIdentityCommand } from '@aws-sdk/client-cognito-identity'
import { S3Client } from '@aws-sdk/client-s3'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'

const REGION = process.env.AWS_REGION ?? 'af-south-1'

function issuerUrl(): string {
  return `cognito-idp.${REGION}.amazonaws.com/${process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID}`
}

interface ScopedCredentials { accessKeyId: string; secretAccessKey: string; sessionToken: string }

// Exchanges the caller's already-verified Cognito ID token for temporary AWS
// credentials scoped by IAM (via the gate-keep-user role's ABAC principal
// tags -- see infrastructure/terraform/cognito/main.tf) to only that
// workspace's files and catalogue partition. Unlike s3Client() / ddbDocClient()
// in lib/aws.ts, requests signed with these are enforced by AWS itself, not
// just by a route building the right key.
async function getScopedCredentials(idToken: string): Promise<ScopedCredentials> {
  const identityClient = new CognitoIdentityClient({ region: REGION })
  const logins = { [issuerUrl()]: idToken }

  const { IdentityId } = await identityClient.send(new GetIdCommand({
    IdentityPoolId: process.env.COGNITO_IDENTITY_POOL_ID,
    Logins: logins,
  }))

  const { Credentials } = await identityClient.send(new GetCredentialsForIdentityCommand({
    IdentityId,
    Logins: logins,
  }))

  if (!Credentials?.AccessKeyId || !Credentials.SecretKey || !Credentials.SessionToken) {
    throw new Error('Failed to obtain scoped credentials')
  }

  return {
    accessKeyId:     Credentials.AccessKeyId,
    secretAccessKey: Credentials.SecretKey,
    sessionToken:    Credentials.SessionToken,
  }
}

export async function getScopedS3Client(idToken: string): Promise<S3Client> {
  return new S3Client({ region: REGION, credentials: await getScopedCredentials(idToken) })
}

// Both clients from ONE credential exchange: most Gate-Keep routes need the
// archive bucket and the catalogue together, and each exchange is two network calls.
export async function getScopedClients(idToken: string): Promise<{ s3: S3Client; db: DynamoDBDocumentClient }> {
  const credentials = await getScopedCredentials(idToken)
  return {
    s3: new S3Client({ region: REGION, credentials }),
    db: DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION, credentials })),
  }
}
