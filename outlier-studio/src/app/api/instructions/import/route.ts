import { AppError } from '@/server/errors';
import { extractFileText, IMPORT_MAX_BYTES } from '@/server/files';
import { json, route } from '@/server/http';
import { INSTRUCTIONS_MAX } from '@/server/instructions';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Reads the text out of an uploaded file (multipart field "file") and returns
 * it for the user to review. Nothing is saved until they save the instructions.
 */
export const POST = route('user', async ({ req }) => {
  if (!req.headers.get('content-type')?.toLowerCase().startsWith('multipart/form-data')) {
    throw new AppError(415, 'unsupported_media_type', 'Upload the file as multipart form data.');
  }
  // A little headroom over the file limit for the multipart framing.
  if (Number(req.headers.get('content-length') ?? 0) > IMPORT_MAX_BYTES + 64 * 1024) {
    throw new AppError(413, 'file_too_large', 'That file is larger than 10 MB.');
  }
  let file: FormDataEntryValue | null;
  try {
    file = (await req.formData()).get('file');
  } catch {
    throw new AppError(400, 'invalid_upload', 'The upload could not be read. Please try again.');
  }
  if (!(file instanceof File)) throw new AppError(400, 'invalid_upload', 'Choose a file to import.');

  const text = await extractFileText(file);
  return json({ fileName: file.name, text: text.slice(0, INSTRUCTIONS_MAX), truncated: text.length > INSTRUCTIONS_MAX });
});
