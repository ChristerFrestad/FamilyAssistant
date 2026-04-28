// User / family-member avatar. Renders a circular (or square)
// image, with a graceful initials fallback when the image is
// missing or fails to load.
//
// Fallback strategy: we never probe the image up front. The browser
// handles the initial fetch; if it fails, the <img>'s onError
// handler flips an internal flag and we re-render the fallback
// surface in place. This keeps the happy path zero-cost (no extra
// network request, no preload) and the failure path fully
// graceful (no flash of broken-image icon).
//
// When src changes, the fallback flag resets via useEffect so a
// new URL gets a fresh chance even if the previous one failed.
//
// Initial generation rules (handled by the local helper):
//   - "Christer Frestad"   -> "CF"  (first letter of first + last word)
//   - "Marie Olsen Berg"   -> "MB"  (first + last, middle skipped)
//   - "Æsop"               -> "Æ"   (single word, first letter only)
//   - ""                   -> "?"   (placeholder for empty/whitespace)
// Norwegian letters (æ, ø, å) are uppercased via toLocaleUpperCase
// with the 'nb-NO' locale so case mapping stays correct under
// future locale-sensitive characters.
//
// Accessibility: the <img> uses `alt` directly. The fallback span
// is decorative (the initials only repeat what `alt` already says
// to assistive tech), so it is wrapped in `aria-hidden`. The outer
// wrapper exposes `role="img"` with `aria-label={alt}` so screen
// readers see one consistent name regardless of which surface is
// rendered.

import { type HTMLAttributes, forwardRef, useEffect, useState } from 'react';

export type AvatarSize = 'sm' | 'md' | 'lg' | 'xl';
export type AvatarShape = 'round' | 'square';

export interface AvatarProps extends HTMLAttributes<HTMLDivElement> {
  /** Image URL. When omitted or when the load fails, the initials fallback shows instead. */
  src?: string;
  /** Required accessible name. Also used to derive initials when no explicit `fallback` is given. */
  alt: string;
  /**
   * Optional override for the fallback text. When omitted, initials
   * are derived from `alt`.
   */
  fallback?: string;
  /** Pixel-size scale. Defaults to 'md' (40 x 40). */
  size?: AvatarSize;
  /** Corner style. Defaults to 'round'. */
  shape?: AvatarShape;
}

const SIZE_CLASSES: Record<AvatarSize, { box: string; text: string }> = {
  sm: { box: 'h-8 w-8', text: 'text-meta' },
  md: { box: 'h-10 w-10', text: 'text-body' },
  lg: { box: 'h-16 w-16', text: 'text-card' },
  xl: { box: 'h-24 w-24', text: 'text-display-md' },
};

const SHAPE_CLASSES: Record<AvatarShape, string> = {
  round: 'rounded-full',
  square: 'rounded-lg',
};

const BASE_CLASSES = [
  'inline-flex items-center justify-center',
  'overflow-hidden',
  'bg-surface text-text-1',
  'border border-stroke',
  'select-none',
].join(' ');

export const Avatar = forwardRef<HTMLDivElement, AvatarProps>(function Avatar(
  { src, alt, fallback, size = 'md', shape = 'round', className, ...rest },
  ref
): JSX.Element {
  const [imgFailed, setImgFailed] = useState(false);

  // When the URL changes, allow the new image one fresh attempt
  // even if the previous one failed. Keeps Avatar correct when a
  // parent flips between known-bad and known-good URLs (e.g.
  // settings change, profile-picture refresh).
  useEffect(() => {
    setImgFailed(false);
  }, [src]);

  const sizeCls = SIZE_CLASSES[size];
  const shapeCls = SHAPE_CLASSES[shape];
  const cls = [BASE_CLASSES, sizeCls.box, sizeCls.text, shapeCls, className]
    .filter(Boolean)
    .join(' ');

  const fallbackText = fallback ?? getInitials(alt);
  const showImage = Boolean(src) && !imgFailed;

  return (
    <div ref={ref} role="img" aria-label={alt} className={cls} {...rest}>
      {showImage ? (
        <img
          src={src}
          alt=""
          onError={() => setImgFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <span aria-hidden="true">{fallbackText}</span>
      )}
    </div>
  );
});

// Derive avatar initials from a free-form name. Exported via a local
// constant so it stays testable from the test file without exporting
// it from the public component API.
export function getInitials(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '?';
  const words = trimmed.split(/\s+/);
  // String.charAt is safe for BMP characters including Æ/Ø/Å.
  if (words.length === 1) {
    return words[0]!.charAt(0).toLocaleUpperCase('nb-NO');
  }
  const first = words[0]!.charAt(0);
  const last = words[words.length - 1]!.charAt(0);
  return (first + last).toLocaleUpperCase('nb-NO');
}
