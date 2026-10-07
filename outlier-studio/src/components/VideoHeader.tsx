import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import { ago, day, duration } from '@/lib/format';
import type { VideoDetail } from '@/lib/types';
import { PLATFORM_NAME } from '@/shared/video-url';
import { watchUrl } from '@/shared/youtube-url';
import { Icon } from './icons';
import { Picture } from './Picture';
import { PlatformBadge } from './PlatformBadge';

export function VideoHeader({ video, children }: { video: VideoDetail['video']; children?: ReactNode }) {
  const platform = PLATFORM_NAME[video.platform];
  return (
    <header className="video-header" style={{ '--video-backdrop': video.thumbnailUrl ? `url("${video.thumbnailUrl.replaceAll('"', '%22')}")` : 'none' } as CSSProperties}>
      <span className="video-backdrop" aria-hidden="true" />
      <div className="video-breadcrumb text-muted">
        <Link href="/app/feed" className="back-link text-link"><Icon.arrowLeft />Back to Videos</Link>
        <span aria-hidden="true">/</span><span>Video intelligence</span>
      </div>
      <div className="video-head">
        <a className="video-thumbnail" href={watchUrl(video)} target="_blank" rel="noreferrer" aria-label={`Watch ${video.title} on ${platform}`}>
          <Picture className="thumb" src={video.thumbnailUrl} lazy={false} />
          <span className="thumbnail-play" aria-hidden="true"><Icon.play /></span>
          {video.durationSeconds !== null && video.durationSeconds > 0 && <span className="thumbnail-duration">{duration(video.durationSeconds)}</span>}
        </a>
        <div className="video-heading">
          <div className="row"><PlatformBadge platform={video.platform} /><span className="eyebrow text-muted">{video.isShort ? 'Short-form video' : 'Long-form video'}</span></div>
          <h1>{video.title}</h1>
          <div className="video-metadata text-muted">
            <Link className="channel-link text-link" href={`/app/feed?channel=${video.channelId}&days=all`}>{video.channelTitle}</Link>
            <span>Published <time dateTime={video.publishedAt}>{day(video.publishedAt)}</time> ({ago(video.publishedAt)})</span>
            {video.durationSeconds !== null && video.durationSeconds > 0 && <span>{duration(video.durationSeconds)} long</span>}
          </div>
          <div className="row video-actions">
            <a className="btn btn-sm" href={watchUrl(video)} target="_blank" rel="noreferrer"><Icon.play />Watch on {platform}<Icon.external /></a>
            <Link className="btn btn-sm" href={`/app/feed?channel=${video.channelId}&days=all`}>More from channel</Link>
            {children}
          </div>
        </div>
      </div>
    </header>
  );
}
