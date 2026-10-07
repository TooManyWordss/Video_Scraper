/**
 * A local stand-in for Apify's synchronous run endpoint, serving the three
 * Actors the app uses (YouTube transcript, TikTok, Instagram). Test tooling
 * only: the app reads APIFY_BASE_URL solely when NODE_ENV is "test".
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { DEFAULT_ACTORS } from '@/server/video/apify';

export const APIFY_TOKEN = 'apify_test_token';

export type FakePost = {
  platform: 'tiktok' | 'instagram';
  id: string;
  username: string;
  displayName: string;
  title: string;
  views: number | null;
  likes?: number;
  comments?: number;
  duration?: number;
  createdAt?: string;
};

export class FakeApify {
  calls: { actor: string; input: Record<string, unknown>; key: string | undefined; cap: string | null }[] = [];
  /** Caption text by YouTube video URL. A null value means "no captions". */
  transcripts = new Map<string, string | null>();
  /** Used for any YouTube URL not listed in transcripts. */
  defaultTranscript: string | null = null;
  /** TikTok and Instagram post data by video URL. */
  posts = new Map<string, FakePost>();
  /** Reels by Instagram username, returned for a profile run. */
  accounts = new Map<string, FakePost[]>();
  /** Profile results by Instagram discovery query. */
  instagramSearches = new Map<string, Record<string, unknown>[]>();
  failNext?: { status: number; message: string };
  /** Bytes served for each downloaded media file, by video id. Missing means no media link is returned. */
  media = new Map<string, Buffer>();
  /** Requests for media files, with whether they carried the Apify token. */
  mediaRequests: { path: string; withToken: boolean }[] = [];
  private server = http.createServer((req, res) => this.handle(req, res));

  async start(port = 0): Promise<string> {
    await new Promise<void>((resolve) => this.server.listen(port, '127.0.0.1', resolve));
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }
  stop(): Promise<void> {
    this.server.closeAllConnections();
    return new Promise((resolve) => this.server.close(() => resolve()));
  }
  reset(): void {
    this.calls = [];
    this.transcripts.clear();
    this.posts.clear();
    this.accounts.clear();
    this.instagramSearches.clear();
    this.defaultTranscript = null;
    this.failNext = undefined;
    this.media.clear();
    this.mediaRequests = [];
  }

  private origin(): string {
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }
  /** The same server under another host name, standing in for a CDN. */
  private cdn(): string {
    return `http://localhost:${(this.server.address() as AddressInfo).port}`;
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = new URL(req.url ?? '/', 'http://x');
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const key = (req.headers.authorization ?? '').replace(/^Bearer /, '') || undefined;

      // Media files: TikTok downloads live in Apify storage (token required), Instagram files on a CDN.
      const media = url.pathname.match(/^\/(?:v2\/key-value-stores\/videos\/records|cdn)\/([^/.]+)/);
      if (media) {
        this.mediaRequests.push({ path: url.pathname, withToken: key === APIFY_TOKEN });
        const bytes = this.media.get(media[1]!);
        if (!bytes || (url.pathname.startsWith('/v2/') && key !== APIFY_TOKEN)) return send(404, { error: { type: 'record-not-found' } });
        res.writeHead(200, { 'content-type': 'audio/mp4', 'content-length': String(bytes.length) });
        return void res.end(bytes);
      }

      const input = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      const actor = url.pathname.match(/^\/v2\/acts\/([^/]+)\/run-sync-get-dataset-items$/)?.[1] ?? '';
      this.calls.push({ actor, input, key, cap: url.searchParams.get('maxTotalChargeUsd') });

      if (key !== APIFY_TOKEN) return send(401, { error: { type: 'token-not-provided', message: 'Authentication token is not valid.' } });
      if (this.failNext) {
        const f = this.failNext;
        this.failNext = undefined;
        return send(f.status, { error: { type: 'fake', message: f.message } });
      }

      if (actor === DEFAULT_ACTORS.youtubeTranscript.replace('/', '~')) {
        const videoUrl = String((input.videoUrls as string[] | undefined)?.[0] ?? '');
        const text = this.transcripts.has(videoUrl) ? this.transcripts.get(videoUrl)! : this.defaultTranscript;
        return send(201, text === null ? [] : [{ url: videoUrl, language: 'en', text }]);
      }

      if (actor === DEFAULT_ACTORS.instagramSearch.replace('/', '~')) {
        const query = String(input.search ?? '');
        return send(201, this.instagramSearches.get(query) ?? []);
      }

      if (actor === DEFAULT_ACTORS.instagram.replace('/', '~') && Array.isArray(input.username)) {
        const target = String(input.username[0]);
        const post = this.posts.get(target);
        if (post) {
          const item = instagramItem(post, target);
          if (this.media.has(post.id)) item.audioUrl = `${this.cdn()}/cdn/${post.id}.m4a`;
          if (input.includeTranscript === true) item.transcript = this.transcripts.has(target) ? this.transcripts.get(target) : this.defaultTranscript;
          return send(201, [item]);
        }
        const reels = this.accounts.get(target) ?? [];
        return send(201, reels.map((p) => instagramItem(p, `https://www.instagram.com/reel/${p.id}/`)));
      }

      const igOrTiktok = actor === DEFAULT_ACTORS.tiktok.replace('/', '~') || actor === DEFAULT_ACTORS.instagram.replace('/', '~');
      if (igOrTiktok) {
        const videoUrl = String((input.postURLs as string[] | undefined)?.[0] ?? (input.directUrls as string[] | undefined)?.[0] ?? '');
        const post = this.posts.get(videoUrl);
        if (!post) return send(201, []);
        const item: Record<string, unknown> = post.platform === 'tiktok' ? tiktokItem(post, videoUrl) : instagramItem(post, videoUrl);
        if (post.platform === 'tiktok') item.mediaUrls = input.shouldDownloadVideos === true && this.media.has(post.id) ? [`${this.origin()}/v2/key-value-stores/videos/records/${post.id}.mp4`] : [];
        return send(201, [item]);
      }

      send(404, { error: { type: 'record-not-found', message: `Actor ${actor} was not found.` } });
    });
  }
}

/** Shaped like the TikTok Actor's dataset items. */
function tiktokItem(p: FakePost, url: string) {
  return {
    id: p.id,
    text: p.title,
    webVideoUrl: url,
    createTimeISO: p.createdAt ?? new Date(Date.now() - 3 * 86_400_000).toISOString(),
    playCount: p.views,
    diggCount: p.likes ?? null,
    commentCount: p.comments ?? null,
    authorMeta: { name: p.username, nickName: p.displayName, avatar: `https://cdn.example/${p.username}.jpg` },
    videoMeta: { duration: p.duration ?? 31, coverUrl: `https://cdn.example/${p.id}.jpg` },
  };
}

/** Shaped like the Instagram reel Actor's dataset items. */
function instagramItem(p: FakePost, url: string): Record<string, unknown> {
  return {
    id: p.id,
    shortCode: p.id,
    url,
    caption: p.title,
    ownerUsername: p.username,
    ownerFullName: p.displayName,
    ownerProfilePicUrl: `https://cdn.example/${p.username}.jpg`,
    videoPlayCount: p.views,
    likesCount: p.likes ?? null,
    commentsCount: p.comments ?? null,
    videoDuration: p.duration ?? 31,
    displayUrl: `https://cdn.example/${p.id}.jpg`,
    timestamp: p.createdAt ?? new Date(Date.now() - 3 * 86_400_000).toISOString(),
  };
}
