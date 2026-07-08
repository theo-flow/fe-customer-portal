import { GetObjectCommand } from '@aws-sdk/client-s3'
import { NextResponse } from 'next/server'
import { s3Client, BUCKET } from '@/lib/aws'

// Public, unauthenticated -- serves the logo cropped from a client's template
// so the public /fill page can render it. The bucket itself stays private;
// this route is the only thing allowed to read out of the branding/ prefix
// on the public's behalf. Key format matches branding_extractor.py exactly:
// branding/{orgId}/{group}/v{version}/logo.png
export async function GET(
  _req: Request,
  { params }: { params: { orgId: string; group: string; version: string } },
) {
  const { orgId, group, version } = params
  const key = `branding/${orgId}/${group}/v${version}/logo.png`

  try {
    const object = await s3Client().send(new GetObjectCommand({ Bucket: BUCKET, Key: key }))
    const bytes  = await object.Body?.transformToByteArray()
    if (!bytes) return new NextResponse(null, { status: 404 })

    return new NextResponse(Buffer.from(bytes), {
      status: 200,
      headers: {
        'Content-Type':  'image/png',
        'Cache-Control': 'public, max-age=86400, immutable',
      },
    })
  } catch {
    return new NextResponse(null, { status: 404 })
  }
}
