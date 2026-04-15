// PERFORMANCE EXCEPTION — pdfjs-dist (~40 MB) and mammoth (~2.5 MB) are lazy-loaded
// inside their respective extraction functions rather than imported at module level.
// Both are only needed when a user actually attaches a PDF or DOCX file in chat.
// A static top-level import would pull both packages into the Turbopack dev cache for
// every page that renders ChatInput (i.e. almost every page), adding ~40 MB to the
// compiled module graph with zero benefit on pages that never use file attachment.
// This is NOT a circular-dependency workaround — that is the reason the ESLint rule
// exists. This is a deliberate, targeted code-split for an infrequently-used feature.

export const MAX_PDF_PAGES = 10;
const MAX_WORDS = 5000; // Word limit for DOCX/TXT documents

export const SUPPORTED_DOC_EXTENSIONS = '.pdf,.docx,.txt';

export async function extractTextFromPDF(
  file: File,
  maxPages: number = MAX_PDF_PAGES
): Promise<{ text: string; totalPages: number }> {
  // eslint-disable-next-line no-restricted-syntax -- performance: see file header comment
  const pdfjsLib = await import('pdfjs-dist');
  // Worker must be configured before getDocument. Safe to set on each call (idempotent).
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url
  ).toString();

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

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

export async function extractTextFromDocx(
  file: File,
  maxWords: number = MAX_WORDS
): Promise<{ text: string; wordCount: number }> {
  // eslint-disable-next-line no-restricted-syntax -- performance: see file header comment
  const { default: mammoth } = await import('mammoth');

  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  if (!result.value.trim()) {
    throw new Error('Could not extract text from DOCX — the document appears empty.');
  }
  const wordCount = countWords(result.value);
  if (wordCount > maxWords) {
    throw new Error(
      `DOCX has ~${wordCount} words, which exceeds the limit of ${maxWords}. Please use a shorter document.`
    );
  }
  return { text: result.value, wordCount };
}

export async function extractTextFromTxt(
  file: File,
  maxWords: number = MAX_WORDS
): Promise<{ text: string; wordCount: number }> {
  const text = await file.text();
  const wordCount = countWords(text);
  if (wordCount > maxWords) {
    throw new Error(
      `TXT has ~${wordCount} words, which exceeds the limit of ${maxWords}. Please use a shorter document.`
    );
  }
  return { text, wordCount };
}

/**
 * Extract text from a supported document file (PDF, DOCX, TXT).
 * Returns extracted text plus pages (PDF) or wordCount (DOCX/TXT).
 */
export async function extractTextFromDocument(
  file: File
): Promise<{ text: string; pages?: number; wordCount?: number }> {
  const name = file.name.toLowerCase();

  if (name.endsWith('.pdf')) {
    const { text, totalPages } = await extractTextFromPDF(file);
    return { text, pages: totalPages };
  }

  if (name.endsWith('.docx')) {
    const { text, wordCount } = await extractTextFromDocx(file);
    return { text, wordCount };
  }

  if (name.endsWith('.txt')) {
    const { text, wordCount } = await extractTextFromTxt(file);
    return { text, wordCount };
  }

  throw new Error(`Unsupported file type: ${file.name}. Supported: PDF, DOCX, TXT.`);
}
