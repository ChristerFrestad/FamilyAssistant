// Tag preview — variants, removable mode, and a small interactive
// example that wires onRemove to local state so the user can click
// X and watch the tag disappear from the preview itself.

import { useState } from 'react';
import { Tag, type TagVariant } from '../../../../app/components/display/Tag';

const VARIANTS: TagVariant[] = ['mint', 'cyan', 'amber', 'coral', 'rose'];

const VARIANT_LABELS: Record<TagVariant, string> = {
  mint: 'Vegetar',
  cyan: 'Lavkarbo',
  amber: 'Glutenfri',
  coral: 'Nøtter',
  rose: 'Allergi',
};

export default function TagPreview(): JSX.Element {
  // Local state so the interactive example actually removes tags
  // when the user clicks X. Resets on full page reload.
  const [removed, setRemoved] = useState<TagVariant[]>([]);
  const visible = VARIANTS.filter((v) => !removed.includes(v));

  return (
    <div className="space-y-4">
      <h3 className="font-body text-meta tracking-wide text-text-2 uppercase">Tag</h3>

      {/* Read-only variants */}
      <div className="bg-canvas-1 rounded-md border border-stroke p-4 space-y-3">
        <code className="font-mono text-label text-text-3 block">variants (read-only)</code>
        <div className="flex flex-wrap items-center gap-3">
          {VARIANTS.map((v) => (
            <Tag key={v} variant={v}>
              {VARIANT_LABELS[v]}
            </Tag>
          ))}
        </div>
      </div>

      {/* Removable, but with a no-op handler — shows the X glyph
          and lets you focus / hover it without consequence. */}
      <div className="bg-canvas-1 rounded-md border border-stroke p-4 space-y-3">
        <code className="font-mono text-label text-text-3 block">removable (no-op handler)</code>
        <div className="flex flex-wrap items-center gap-3">
          {VARIANTS.map((v) => (
            <Tag key={v} variant={v} removable onRemove={() => undefined}>
              {VARIANT_LABELS[v]}
            </Tag>
          ))}
        </div>
      </div>

      {/* Interactive example — clicking X actually removes the
          tag from local state. Refresh the page to reset. */}
      <div className="bg-canvas-1 rounded-md border border-stroke p-4 space-y-3">
        <code className="font-mono text-label text-text-3 block">interactive (state-driven)</code>
        <div className="flex flex-wrap items-center gap-3 min-h-[2.5rem]">
          {visible.length === 0 ? (
            <span className="font-body text-meta text-text-3">
              Alle fjernet — last siden på nytt for å gjenopprette
            </span>
          ) : (
            visible.map((v) => (
              <Tag
                key={v}
                variant={v}
                removable
                onRemove={() => setRemoved((prev) => [...prev, v])}
              >
                {VARIANT_LABELS[v]}
              </Tag>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
