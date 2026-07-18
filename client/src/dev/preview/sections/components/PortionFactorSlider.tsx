// PortionFactorSlider preview — three role defaults (barn 0.4 /
// ungdom 0.7 / voksen 1.0), three sizes, disabled state, custom
// description, and an interactive section where the user can drag
// the thumb and watch the numeric/label/fill update in lockstep.

import type { JSX } from 'react';
import { useState } from 'react';
import {
  PortionFactorSlider,
  getPortionFactorDefault,
  type PortionFactorSliderSize,
} from '../../../../app/components/form/PortionFactorSlider';

const SIZES: PortionFactorSliderSize[] = ['sm', 'md', 'lg'];

export default function PortionFactorSliderPreview(): JSX.Element {
  const [interactive, setInteractive] = useState(getPortionFactorDefault('adult'));

  return (
    <div className="space-y-4">
      <h3 className="font-body text-meta tracking-wide text-text-2 uppercase">
        Portion-factor slider
      </h3>

      {/* Role defaults — show the three preset values side by side */}
      <div className="bg-canvas-1 rounded-md border border-stroke p-4 space-y-4">
        <code className="font-mono text-label text-text-3 block">role defaults</code>
        <PortionFactorSlider value={getPortionFactorDefault('child')} onChange={() => undefined} />
        <PortionFactorSlider value={getPortionFactorDefault('teen')} onChange={() => undefined} />
        <PortionFactorSlider value={getPortionFactorDefault('adult')} onChange={() => undefined} />
      </div>

      {/* Sizes */}
      <div className="bg-canvas-1 rounded-md border border-stroke p-4 space-y-6">
        <code className="font-mono text-label text-text-3 block">sizes</code>
        {SIZES.map((s) => (
          <div key={s} className="space-y-1">
            <code className="font-mono text-label text-text-3 block">size={s}</code>
            <PortionFactorSlider value={1.0} onChange={() => undefined} size={s} />
          </div>
        ))}
      </div>

      {/* Disabled */}
      <div className="bg-canvas-1 rounded-md border border-stroke p-4 space-y-3">
        <code className="font-mono text-label text-text-3 block">disabled</code>
        <PortionFactorSlider value={1.0} onChange={() => undefined} disabled />
      </div>

      {/* Custom description */}
      <div className="bg-canvas-1 rounded-md border border-stroke p-4 space-y-3">
        <code className="font-mono text-label text-text-3 block">custom description</code>
        <PortionFactorSlider
          value={0.7}
          onChange={() => undefined}
          description="Pasta carbonara har normalt 110 g pasta per voksen. Juster om noen vil ha mer eller mindre."
        />
      </div>

      {/* Interactive — drag/keyboard, value updates everything */}
      <div className="bg-canvas-1 rounded-md border border-stroke p-4 space-y-3">
        <code className="font-mono text-label text-text-3 block">
          interactive (drag or arrow keys)
        </code>
        <PortionFactorSlider value={interactive} onChange={setInteractive} />
        <p className="font-mono text-label text-text-3">
          current state value: {interactive.toFixed(1)}
        </p>
      </div>
    </div>
  );
}
