// Toggle preview — sizes, on/off pairs, label/description, disabled,
// and a useState-backed interactive group so the user can click each
// toggle and watch the track-color and thumb-translate animation.
//
// The static (non-interactive) examples keep their `checked` prop
// fixed via a no-op onChange so the visual states are observable
// in the page without state plumbing per row.

import { useState } from 'react';
import { Toggle, type ToggleSize } from '../../../../app/components/form/Toggle';

const SIZES: ToggleSize[] = ['sm', 'md', 'lg'];

export default function TogglePreview(): JSX.Element {
  // Local state for the interactive section. Refresh resets.
  const [notifs, setNotifs] = useState(true);
  const [darkMode, setDarkMode] = useState(false);
  const [autoSync, setAutoSync] = useState(false);

  return (
    <div className="space-y-4">
      <h3 className="font-body text-meta tracking-wide text-text-2 uppercase">Toggle</h3>

      {/* Size grid: each size shown OFF then ON */}
      <div className="bg-canvas-1 rounded-md border border-stroke p-4 space-y-3">
        <code className="font-mono text-label text-text-3 block">sizes (off → on)</code>
        {SIZES.map((s) => (
          <div key={s} className="flex flex-wrap items-center gap-6">
            <code className="font-mono text-label text-text-3 min-w-[3rem]">{s}</code>
            <Toggle size={s} checked={false} onChange={() => undefined} />
            <Toggle size={s} checked onChange={() => undefined} />
          </div>
        ))}
      </div>

      {/* With label only */}
      <div className="bg-canvas-1 rounded-md border border-stroke p-4 space-y-3">
        <code className="font-mono text-label text-text-3 block">label only</code>
        <Toggle checked={false} onChange={() => undefined} label="Push-varsler" />
        <Toggle checked onChange={() => undefined} label="Push-varsler" />
      </div>

      {/* With label + description */}
      <div className="bg-canvas-1 rounded-md border border-stroke p-4 space-y-3">
        <code className="font-mono text-label text-text-3 block">label + description</code>
        <Toggle
          checked={false}
          onChange={() => undefined}
          label="Mørk modus"
          description="Bytter automatisk ved solnedgang"
        />
        <Toggle
          checked
          onChange={() => undefined}
          label="Auto-bekreft uke"
          description="Send ukesplan til familien hver søndag kl 18"
        />
      </div>

      {/* Disabled — both states */}
      <div className="bg-canvas-1 rounded-md border border-stroke p-4 space-y-3">
        <code className="font-mono text-label text-text-3 block">disabled</code>
        <Toggle
          disabled
          checked={false}
          onChange={() => undefined}
          label="Kalender-integrasjon (krever Google-konto)"
        />
        <Toggle
          disabled
          checked
          onChange={() => undefined}
          label="Eksperimentell AI-modus (lås under pilot)"
        />
      </div>

      {/* Interactive section — clicking actually toggles state. Refresh restores defaults. */}
      <div className="bg-canvas-1 rounded-md border border-stroke p-4 space-y-3">
        <code className="font-mono text-label text-text-3 block">interactive (state-driven)</code>
        <Toggle
          checked={notifs}
          onChange={setNotifs}
          label="Push-varsler"
          description="Daglig påminnelse om gjøremål kl 08"
        />
        <Toggle
          checked={darkMode}
          onChange={setDarkMode}
          label="Mørk modus"
          description="Overstyrer system-tema"
        />
        <Toggle
          checked={autoSync}
          onChange={setAutoSync}
          label="Auto-synk handleliste"
          description="Send til Oda hver mandag kl 09"
        />
      </div>
    </div>
  );
}
