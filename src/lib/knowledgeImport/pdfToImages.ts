import { pdf } from "pdf-to-img";
import { MAX_PDF_PAGES } from "@/lib/knowledgeImport/constants";

export interface RenderedPdfPage {
  pageNumber: number;
  buffer: Buffer;
  mimeType: "image/png";
}

/**
 * Renders up to maxPages of a PDF to PNG images, in memory (no temp
 * files — Vercel serverless functions have a read-only filesystem outside
 * /tmp). Uses pdf-to-img (pdfjs-dist + a WASM canvas, no native binary
 * dependency), so it runs the same way locally and on Vercel. Returns
 * null on any failure (encrypted, corrupt, or unreadable PDF) — callers
 * treat that identically to any other extraction failure for that file,
 * following this codebase's fail-safe house style.
 */
export async function renderPdfToImages(
  pdfBuffer: Buffer,
  maxPages: number = MAX_PDF_PAGES
): Promise<RenderedPdfPage[] | null> {
  try {
    const dataUrl = `data:application/pdf;base64,${pdfBuffer.toString("base64")}`;
    const document = await pdf(dataUrl, { scale: 2 });

    const pages: RenderedPdfPage[] = [];
    let pageNumber = 0;
    for await (const image of document) {
      pageNumber++;
      if (pageNumber > maxPages) break;
      pages.push({ pageNumber, buffer: image, mimeType: "image/png" });
    }

    return pages.length > 0 ? pages : null;
  } catch (err) {
    console.error("[knowledgeImport] PDF render failed:", err);
    return null;
  }
}
