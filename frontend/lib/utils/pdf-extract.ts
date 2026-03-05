import * as pdfjsLib from 'pdfjs-dist';

// Configure worker — use bundled worker from pdfjs-dist
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

export const MAX_PDF_PAGES = 10;

export async function extractTextFromPDF(
  file: File,
  maxPages: number = MAX_PDF_PAGES
): Promise<{ text: string; totalPages: number }> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const totalPages = pdf.numPages;

  if (totalPages > maxPages) {
    throw new Error(
      `PDF has ${totalPages} pages, which exceeds the limit of ${maxPages}. Please use a shorter document.`
    );
  }

  const pageTexts: string[] = [];
  for (let i = 1; i <= totalPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const text = textContent.items
      .map((item: any) => item.str)
      .join(' ');
    pageTexts.push(`--- Page ${i} ---\n${text}`);
  }

  return {
    text: pageTexts.join('\n\n'),
    totalPages,
  };
}
