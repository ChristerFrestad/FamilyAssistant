// Avatar preview — sizes, shapes, with-image vs fallback paths,
// and the initial-generation rules from real-looking family names.
// The fallback case is intentionally exercised with a missing src
// so the preview surfaces what users see if a profile picture
// fails to load.

import type { JSX } from 'react';
import {
  Avatar,
  type AvatarShape,
  type AvatarSize,
} from '../../../../app/components/display/Avatar';

const SIZES: AvatarSize[] = ['sm', 'md', 'lg', 'xl'];
const SHAPES: AvatarShape[] = ['round', 'square'];

const FALLBACK_NAMES = [
  'Christer Frestad', // -> CF
  'Marie Olsen Berg', // -> MB
  'Æsop', // -> Æ
  'åse øystein', // -> ÅØ
];

export default function AvatarPreview(): JSX.Element {
  return (
    <div className="space-y-4">
      <h3 className="font-body text-meta tracking-wide text-text-2 uppercase">Avatar</h3>

      {/* Sizes (round) */}
      <div className="bg-canvas-1 rounded-md border border-stroke p-4 space-y-3">
        <code className="font-mono text-label text-text-3 block">sizes (fallback)</code>
        <div className="flex flex-wrap items-end gap-3">
          {SIZES.map((s) => (
            <div key={s} className="text-center space-y-1">
              <Avatar size={s} alt="Christer Frestad" />
              <code className="font-mono text-label text-text-3 block">{s}</code>
            </div>
          ))}
        </div>
      </div>

      {/* Shapes */}
      <div className="bg-canvas-1 rounded-md border border-stroke p-4 space-y-3">
        <code className="font-mono text-label text-text-3 block">shapes</code>
        <div className="flex flex-wrap items-end gap-3">
          {SHAPES.map((sh) => (
            <div key={sh} className="text-center space-y-1">
              <Avatar shape={sh} size="lg" alt="Christer Frestad" />
              <code className="font-mono text-label text-text-3 block">{sh}</code>
            </div>
          ))}
        </div>
      </div>

      {/* Initial generation from various names */}
      <div className="bg-canvas-1 rounded-md border border-stroke p-4 space-y-3">
        <code className="font-mono text-label text-text-3 block">
          initial-generering (fallback)
        </code>
        <div className="flex flex-wrap items-end gap-3">
          {FALLBACK_NAMES.map((name) => (
            <div key={name} className="text-center space-y-1">
              <Avatar size="md" alt={name} />
              <code className="font-mono text-label text-text-3 block">{name}</code>
            </div>
          ))}
        </div>
      </div>

      {/* Image-load failure path: an obviously-broken src triggers
          onError, which swaps to initials in place. The same code
          path runs in production when a real profile-picture URL
          404s. */}
      <div className="bg-canvas-1 rounded-md border border-stroke p-4 space-y-3">
        <code className="font-mono text-label text-text-3 block">
          src=&quot;/missing.jpg&quot; → onError → fallback
        </code>
        <Avatar src="/missing.jpg" alt="Christer Frestad" size="lg" />
      </div>

      {/* Explicit fallback override */}
      <div className="bg-canvas-1 rounded-md border border-stroke p-4 space-y-3">
        <code className="font-mono text-label text-text-3 block">fallback=&quot;VIP&quot;</code>
        <Avatar alt="Christer Frestad" fallback="VIP" size="lg" />
      </div>
    </div>
  );
}
