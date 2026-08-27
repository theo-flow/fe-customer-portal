import { CognitoIdentityClient, GetIdCommand, GetCredentialsForIdentityCommand } from '@aws-sdk/client-cognito-identity'
import { S3Client } from '@aws-sdk/client-s3'

const REGION = process.env.AWS_REGION ?? 'af-south-1'

function issuerUrl(): string {
  return `cognito-idp.${REGION}.amazonaws.com/${process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID}`
}

// Exchanges the caller's already-verified Cognito ID token for temporary AWS
// credentials scoped by IAM (via the gate-keep-user role's ABAC principal
// tags -- see infrastructure/terraform/cognito/main.tf) to only that user's
// own gate-keep/{orgId}/{userId}/ prefix in daai-insure-intake. Unlike
// s3Client() in lib/aws.ts, requests signed with this client are enforced by
// AWS itself, not just by this route's own logic building the right key.
export async function getScopedS3Client(idToken: string): Promise<S3Client> {
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

  return new S3Client({
    region: REGION,
    credentials: {
      accessKeyId:     Credentials.AccessKeyId,
      secretAccessKey: Credentials.SecretKey,
      sessionToken:    Credentials.SessionToken,
    },
  })
}
