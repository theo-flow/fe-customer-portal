import { pdfjs } from 'react-pdf'
import { linesFromItems, type PdfTextItem, type TextLine } from '@/lib/pdf-text'

// Client only, loaded on demand from the editor. Reads the sample PDF's text
// line by line so recognition phrases can be suggested from it.
export async function readSampleLines(url: string): Promise<{ page: number; lines: TextLine[] }[]> {
  const doc = await pdfjs.getDocument(url).promise
  try {
    const pages: { page: number; lines: TextLine[] }[] = []
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n)
      const viewport = page.getViewport({ scale: 1 })
      const content = await page.getTextContent()
      const items = content.items.filter((i): i is typeof i & PdfTextItem => 'str' in i && Array.isArray((i as PdfTextItem).transform))
      pages.push({ page: n, lines: linesFromItems(items as PdfTextItem[], viewport.height) })
    }
    return pages
  } finally {
    await doc.destroy()
  }
}
