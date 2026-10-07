import { PLATFORM_NAME, type VideoPlatform } from '@/shared/video-url';
import { PlatformLogo } from './PlatformLogo';

/**
 * Shows which platform an account or video is on: the platform's logo in its
 * own colours, and its name unless `iconOnly` (the name is then read out by
 * screen readers and shown on hover).
 */
export function PlatformBadge({ platform, iconOnly = false, className = '' }: { platform: VideoPlatform; iconOnly?: boolean; className?: string }) {
  const name = PLATFORM_NAME[platform];
  return (
    <span className={`pbadge ${className}`} data-p={platform} title={iconOnly ? name : undefined} role={iconOnly ? 'img' : undefined} aria-label={iconOnly ? name : undefined}>
      <span className="pbadge-mark">
        <PlatformLogo platform={platform} />
      </span>
      {!iconOnly && <span className="pbadge-name">{name}</span>}
    </span>
  );
}
