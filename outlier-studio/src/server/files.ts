import 'server-only';
import { AppError } from './errors';

export const IMPORT_MAX_BYTES = 10 * 1024 * 1024;

const unreadable = (name: string) =>
  new AppError(422, 'file_unreadable', `Could not read any text from ${name}. Use a PDF, a Word document or a plain text file.`);

/** The file's extension in lower case, without the dot. */
function extension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}

/** Bytes that contain NUL characters are a binary format this importer does not understand. */
function looksBinary(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, 8192);
  return sample.includes(0);
}

/** Enough RTF handling for instructions: drops control words and groups, keeps the words. */
function rtfToText(rtf: string): string {
  return rtf
    .replace(/\\par[d]?/g, '\n')
    .replace(/\{\\\*[^{}]*\}/g, '')
    .replace(/\\'([0-9a-f]{2})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\[a-z]+-?\d* ?/gi, '')
    .replace(/[{}]/g, '');
}

async function pdfText(bytes: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import('unpdf');
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}

async function wordText(bytes: Uint8Array): Promise<string> {
  const { default: WordExtractor } = await import('word-extractor');
  const doc = await new WordExtractor().extract(Buffer.from(bytes));
  return doc.getBody();
}

/** Tidies extracted text: one kind of line break, no runs of blank lines or trailing spaces. */
function tidy(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Pulls the text out of an uploaded file. PDFs and Word documents (.doc and
 * .docx) are parsed; anything else is read as UTF-8 text unless it is binary.
 */
export async function extractFileText(file: File): Promise<string> {
  if (file.size === 0) throw unreadable(file.name);
  if (file.size > IMPORT_MAX_BYTES) throw new AppError(413, 'file_too_large', 'That file is larger than 10 MB.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const ext = extension(file.name);

  let text: string;
  try {
    if (ext === 'pdf' || file.type === 'application/pdf') text = await pdfText(bytes);
    else if (ext === 'docx' || ext === 'doc') text = await wordText(bytes);
    else if (looksBinary(bytes)) throw unreadable(file.name);
    else {
      text = new TextDecoder('utf-8').decode(bytes).replace(/^﻿/, '');
      if (ext === 'rtf' || text.startsWith('{\\rtf')) text = rtfToText(text);
    }
  } catch (err) {
    if (err instanceof AppError) throw err;
    // A corrupt or password-protected document: say so instead of failing with a 500.
    throw unreadable(file.name);
  }

  const clean = tidy(text);
  if (!clean) throw unreadable(file.name);
  return clean;
}
