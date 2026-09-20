import { pdfjs } from 'react-pdf'
import { pageTextFromItems, type PdfTextItem } from '@/lib/pdf-text'
import type { UploadInfo } from '@/lib/sign-form-match'
import type { PositionedItem } from '@/lib/sign-recipients'

// Must be set in this same module (react-pdf's requirement), same as
// DocumentPreview.tsx. Import this file only from client code and only
// dynamically (await import('./pdf-read')): pdfjs cannot be evaluated during
// server rendering.
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

// Reads what is needed to tell which saved form an uploaded PDF is: page
// count, the size of page 1, and the text of every page.
export async function readUploadInfo(file: File): Promise<UploadInfo> {
  const data = new Uint8Array(await file.arrayBuffer())
  const doc = await pdfjs.getDocument({ data }).promise
  try {
    const first = await doc.getPage(1)
    const viewport = first.getViewport({ scale: 1 })
    const pageTexts: string[] = []
    const pageItems: PositionedItem[][] = []
    for (let n = 1; n <= doc.numPages; n++) {
      const page = n === 1 ? first : await doc.getPage(n)
      const content = await page.getTextContent()
      const items = content.items.filter(i => 'str' in i) as unknown as PdfTextItem[]
      pageTexts.push(pageTextFromItems(items))
      pageItems.push((items as unknown as (PositionedItem & { width?: number; height?: number })[]).map(i => ({
        str: i.str, transform: i.transform, width: i.width ?? 0, height: i.height ?? 0,
      })))
    }
    return { pageCount: doc.numPages, pageWidth: viewport.width, pageHeight: viewport.height, pageTexts, pageItems }
  } finally {
    await doc.destroy()
  }
}
