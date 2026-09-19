import { pdfjs } from 'react-pdf'

// Must be set in this same module (react-pdf's requirement), same as
// DocumentPreview.tsx. Import this file only from client code, and only
// dynamically (await import('./pdf-info')): pdfjs cannot be evaluated during
// server rendering.
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

export interface PdfInfo {
  pageCount:  number
  pageWidth:  number   // PDF points, page 1
  pageHeight: number
}

// Reads the page count and the size of page 1 so a Sign form knows what
// document shape its layout was made for.
export async function readPdfInfo(file: File): Promise<PdfInfo> {
  const data = new Uint8Array(await file.arrayBuffer())
  const doc = await pdfjs.getDocument({ data }).promise
  try {
    const page = await doc.getPage(1)
    const viewport = page.getViewport({ scale: 1 })
    return { pageCount: doc.numPages, pageWidth: viewport.width, pageHeight: viewport.height }
  } finally {
    await doc.destroy()
  }
}
