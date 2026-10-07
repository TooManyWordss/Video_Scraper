import 'server-only';
import { env } from '../env';
import { AppError } from '../errors';
import type { MediaSource, Transcript } from '../video/apify';
import { transcribeAudio, type AudioTranscription } from './service';

/**
 * Speech-to-text for TikTok and Instagram videos: download the sound, send it
 * to Groq's Whisper, keep the words. Usage is recorded like every other AI
 * request, priced by audio length rather than tokens.
 */

const DOWNLOAD_TIMEOUT_MS = 60_000;

const tooLarge = (mb: number) =>
  new AppError(413, 'audio_too_large', `This video's audio is larger than ${mb} MB, the most the transcription service accepts. You can paste a transcript in instead.`);
const unavailable = () => new AppError(422, 'audio_unavailable', "The video's audio could not be downloaded. You can paste a transcript in instead.");
const silent = () => new AppError(422, 'transcript_unavailable', 'No speech was found in this video. You can paste a transcript in instead.');

/** Downloads the media, refusing anything over the size limit without reading all of it. */
async function download(source: MediaSource, maxBytes: number, mb: number): Promise<Uint8Array<ArrayBuffer>> {
  let res: Response;
  try {
    res = await fetch(source.url, { headers: source.headers, signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS), redirect: 'follow' });
  } catch {
    throw unavailable();
  }
  if (!res.ok || !res.body) throw unavailable();
  if (Number(res.headers.get('content-length') ?? 0) > maxBytes) throw tooLarge(mb);

  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw tooLarge(mb);
    }
    chunks.push(value);
  }
  if (size === 0) throw unavailable();
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.byteLength;
  }
  return bytes;
}

/**
 * Whisper can invent words over music or silence. A segment it rates as
 * probably not speech and has low confidence in is dropped (the usual
 * Whisper thresholds).
 */
function spokenText(v: AudioTranscription): string {
  const segments = v.segments ?? [];
  const text = segments.length
    ? segments.filter((s) => !((s.no_speech_prob ?? 0) > 0.6 && (s.avg_logprob ?? 0) < -1)).map((s) => s.text ?? '').join(' ')
    : (v.text ?? '');
  return text.replace(/\s+/g, ' ').trim();
}

/** Language names from verbose_json ("english") mapped to short codes where known. */
const LANG: Record<string, string> = { english: 'en', spanish: 'es', french: 'fr', german: 'de', portuguese: 'pt', italian: 'it' };

/**
 * Transcribes a video's sound. `hint` (for example the video's title) helps
 * Whisper spell names and terms that appear in it.
 */
export async function transcribeMedia(userId: string, source: MediaSource, hint?: string): Promise<Transcript> {
  const mb = env().GROQ_AUDIO_MAX_MB;
  // Downloaded before any AI request is recorded, so a bad link costs no AI usage.
  const bytes = await download(source, mb * 1024 * 1024, mb);
  const ext = /\.(mp3|m4a|mp4|webm|ogg|wav|flac)$/i.exec(new URL(source.url).pathname)?.[1]?.toLowerCase() ?? 'mp4';

  const { data } = await transcribeAudio({ userId, file: new File([bytes], `audio.${ext}`), prompt: hint?.slice(0, 400) });
  const text = spokenText(data);
  if (text.length < 10) throw silent();
  const lang = data.language ? (LANG[data.language.toLowerCase()] ?? data.language.toLowerCase()) : null;
  return { text, lang };
}
