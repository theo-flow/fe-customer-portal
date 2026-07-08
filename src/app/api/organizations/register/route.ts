import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { fromIni } from '@aws-sdk/credential-providers'
import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'

const REGION = process.env.AWS_REGION          ?? 'af-south-1'
const BUCKET = process.env.S3_INTAKE_BUCKET    ?? 'daai-insure-intake'
const TABLE  = process.env.DYNAMODB_TABLE_ORGS ?? 'daai-insure-orgs'

function credentials() {
  const profile = process.env.AWS_PROFILE
  return profile ? fromIni({ profile }) : undefined
}

function dynamo() {
  return DynamoDBDocumentClient.from(
    new DynamoDBClient({ region: REGION, credentials: credentials() })
  )
}

function s3() {
  return new S3Client({ region: REGION, credentials: credentials() })
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const ALLOWED_CONTENT_TYPES = new Set([
  'application/pdf', 'image/jpeg', 'image/png', 'image/tiff',
])

interface TemplateEntry {
  group:       string
  groupLabel:  string
  filename:    string
  contentType: string
}

export async function POST(req: NextRequest) {
  const {
    orgName, regNumber, orgType, phone,
    adminName, adminEmail,
    subscribedProducts,
    templates,   // only entries where the user chose to upload a file
    formGroups,  // all selected { group, groupLabel } pairs (including "use standard")
  } = await req.json() as {
    orgName:            string
    regNumber:          string
    orgType:            string
    phone:              string
    adminName:          string
    adminEmail:         string
    subscribedProducts: string[]
    templates:          TemplateEntry[]
    formGroups:         { group: string; groupLabel: string }[]
  }

  const VALID_PRODUCTS = new Set(['forge', 'channel', 'harvest', 'decode', 'sign', 'print'])
  if (!orgName?.trim() || !adminEmail?.trim()) {
    return NextResponse.json({ error: 'orgName and adminEmail are required' }, { status: 400 })
  }
  if (!subscribedProducts?.length) {
    return NextResponse.json({ error: 'Select at least one TheoFlow product' }, { status: 400 })
  }
  const invalidProduct = subscribedProducts.find(p => !VALID_PRODUCTS.has(p))
  if (invalidProduct) {
    return NextResponse.json({ error: `Unknown product: ${invalidProduct}` }, { status: 400 })
  }
  if (!EMAIL_RE.test(adminEmail.trim())) {
    return NextResponse.json({ error: 'adminEmail is not a valid email address' }, { status: 400 })
  }
  const invalidTemplate = templates?.find(t => t.contentType && !ALLOWED_CONTENT_TYPES.has(t.contentType))
  if (invalidTemplate) {
    return NextResponse.json(
      { error: `Unsupported file type: ${invalidTemplate.contentType}. Allowed: PDF, JPEG, PNG, TIFF` },
      { status: 400 }
    )
  }

  const orgId = `org-${randomUUID().slice(0, 8)}`
  const now   = new Date().toISOString()

  await dynamo().send(new PutCommand({
    TableName: TABLE,
    Item: {
      PK:         `ORG#${orgId}`,
      SK:         'PROFILE',
      orgId,
      orgName:             orgName.trim(),
      regNumber:           regNumber?.trim() ?? '',
      orgType:             orgType ?? '',
      phone:               phone?.trim() ?? '',
      adminName:           adminName?.trim() ?? '',
      adminEmail:          adminEmail.trim().toLowerCase(),
      subscribed_products: subscribedProducts,
      form_groups:         formGroups ?? [],
      createdAt:           now,
      status:              'pending_verification',
    },
  }))

  // Generate presigned PUT URLs only for files the user is uploading
  const uploadUrls = templates?.length
    ? await Promise.all(
        templates.map(async (t) => {
          const slug = (s: string) => s.toLowerCase().replace(/\s+/g, '-')
          const key  = `templates/${orgId}/${slug(t.groupLabel)}/${t.filename}`
          const url  = await getSignedUrl(
            s3(),
            new PutObjectCommand({
              Bucket:      BUCKET,
              Key:         key,
              ContentType: t.contentType,
              Metadata:    { 'org-id': orgId, 'group': t.group, 'group-label': t.groupLabel },
            }),
            { expiresIn: 600 }
          )
          return { group: t.group, groupLabel: t.groupLabel, uploadUrl: url }
        })
      )
    : []

  return NextResponse.json({ orgId, uploadUrls })
}
