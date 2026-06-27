import { GetCommand } from '@aws-sdk/lib-dynamodb'
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { ddbDocClient, TABLE } from '@/lib/aws'

function statusToActiveStage(status: string): number {
  switch (status) {
    case 'PENDING':    return 0
    case 'UPLOADED':   return 1
    case 'CLASSIFIED': return 2
    case 'EXTRACTED':  return 3
    case 'VALIDATED':  return 4
    case 'FILED':      return 5
    case 'COMPLETE':   return -1
    default:           return 0
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: { docId: string } }
) {
  const token = cookies().get('tf_token')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { docId } = params
  const result = await ddbDocClient().send(new GetCommand({ TableName: TABLE, Key: { PK: `DOC#${docId}`, SK: 'STATUS' } }))

  if (!result.Item) return NextResponse.json({ error: 'Document not found' }, { status: 404 })

  const { status, product, docType, filename, fileSize, createdAt } = result.Item
  return NextResponse.json({ docId, status, activeStage: statusToActiveStage(status as string), product, docType, filename, fileSize, createdAt })
}
