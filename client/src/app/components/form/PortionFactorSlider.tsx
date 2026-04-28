// Portion-factor slider for the meal-planning surfaces. The user
// scales a recipe's per-person quantities by a factor between 0.2
// and 1.5 in 0.1 steps (14 discrete values). Values cluster around
// the three role defaults — barn 0.4, ungdom 0.7, voksen 1.0 —
// from `getPortionFactorDefault()`, but the user can land anywhere
// in the band so a small eater on a big day is just two arrow
// presses away.
//
// Interaction model:
//   - The component is built on a real <input type="range">. The
//     browser handles drag (mouse + touch), keyboard (Left/Right
//     = +/- step, PageUp/Down = +/- big step, Home/End = min/max),
//     focus, and the aria-value* family for screen readers. We
//     never rebuild any of that by hand.
//   - The input itself stays visible — sr-only would also hide the
//     drag interaction, which is the whole point of a slider. The
//     visual is achieved by styling the input with `appearance-none`
//     and applying vendor pseudo-element rules to the thumb.
//
// Cross-browser styling:
//   The native range thumb requires both ::-webkit-slider-thumb
//   (Chromium, Safari, Edge) and ::-moz-range-thumb (Firefox)
//   selectors — there is no shared standard. Tailwind v3.4
//   arbitrary-selector syntax (`[&::-webkit-slider-thumb]:`) lets
//   us compose these into the className string without escaping
//   into a separate stylesheet. The two sets are intentionally
//   verbose to keep the styling colocated with everything else
//   the component does.
//
// Track fill (the colored portion from min to current value) uses
// a CSS gradient on the input's background. The gradient stop is
// computed from the controlled `value` and applied via inline
// `style`, the one place inline style beats a Tailwind class
// because the stop is dynamic and Tailwind cannot generate
// arbitrary percent-stop utilities.
//
// Tick marks: 14 small vertical lines under the track at every
// step value, with the major tick at 1.0 (voksen default). The
// ticks are positioned via simple percent of the parent's width;
// they ignore the thumb-half-width inset on the input's visual
// track. The visual misalignment is a few pixels at most and
// matches the expectation that ticks read as "evenly distributed
// scale markers" rather than "exact value coordinates".

import { type InputHTMLAttributes, type CSSProperties, forwardRef } from 'react';

export const MIN_PORTION = 0.2;
export const MAX_PORTION = 1.5;
export const STEP_PORTION = 0.1;

// Discrete values — used for the tick-mark visual under the track.
// Listed explicitly (rather than computed) so a single source of
// truth exists for the 14 stops we promise to honor.
const TICK_VALUES = [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4, 1.5] as const;

const DEFAULT_DESCRIPTION =
  '1.0 = voksenporsjon (ca 500 g ferdig mat). Kan justeres basert på faktisk appetitt.';

export type PortionFactorSliderSize = 'sm' | 'md' | 'lg';

export type PortionRole = 'adult' | 'teen' | 'child';
export type PortionLabel = 'barn' | 'ungdom' | 'voksen';

// Default value per family-role bucket. Locked in
// design/2026-04-redesign/extracted/locked-decisions.md (Beslutning 2)
// — voksen 1.0, ungdom 0.7, barn 0.4. Exported so the consumer can
// seed `value` from a family-member's role without duplicating the
// mapping at the call site.
export function getPortionFactorDefault(role: PortionRole): number {
  switch (role) {
    case 'adult':
      return 1.0;
    case 'teen':
      return 0.7;
    case 'child':
      return 0.4;
  }
}

// Threshold mapping — see locked-decisions Beslutning 2 plus
// Christer's clarification (Batch E spec): the bands span the full
// 0.2-1.5 scale so small adjustments around a default do not flip
// the visible label.
//
//   0.2 - 0.5 -> barn
//   0.6 - 0.8 -> ungdom
//   0.9 - 1.5 -> voksen
//
// Out-of-range values (defensive only — the slider clamps via
// min/max in normal use) snap to the nearest band: < 0.2 -> barn,
// > 1.5 -> voksen.
export function getPortionLabel(value: number): PortionLabel {
  if (value <= 0.5) return 'barn';
  if (value <= 0.8) return 'ungdom';
  return 'voksen';
}

export interface PortionFactorSliderProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'onChange' | 'value' | 'min' | 'max' | 'step' | 'size'
> {
  /** Current portion factor. Controlled. Should be in [0.2, 1.5]. */
  value: number;
  /** Fires with the new factor (already snapped to the 0.1 step by the native input). */
  onChange: (value: number) => void;
  /** Optional description below the slider. Defaults to the locked-in voksenporsjon helper text. */
  description?: string;
  /** Visual scale. Defaults to 'md'. */
  size?: PortionFactorSliderSize;
}

const NUMERIC_TEXT_SIZE: Record<PortionFactorSliderSize, string> = {
  sm: 'text-display-md',
  md: 'text-screen',
  lg: 'text-hero',
};

const TRACK_HEIGHT: Record<PortionFactorSliderSize, string> = {
  sm: 'h-1.5',
  md: 'h-2',
  lg: 'h-2.5',
};

// Vendor-pseudo-element thumb sizes per scale step. Same dimensions
// for ::-webkit-slider-thumb and ::-moz-range-thumb so the thumb
// looks identical across browsers. Composed as one big space-
// separated string so it slots into the input's className list.
const THUMB_SIZE_CLASSES: Record<PortionFactorSliderSize, string> = {
  sm: '[&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4',
  md: '[&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-5 [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:w-5',
  lg: '[&::-webkit-slider-thumb]:h-6 [&::-webkit-slider-thumb]:w-6 [&::-moz-range-thumb]:h-6 [&::-moz-range-thumb]:w-6',
};

// Shared thumb styling that does not vary by size. Two parallel
// blocks — one per vendor — because there is no way to combine the
// selectors. Keep the property order identical between the two
// blocks so future edits stay in lockstep.
const THUMB_BASE_CLASSES = [
  // WebKit / Blink / Edge
  '[&::-webkit-slider-thumb]:appearance-none',
  '[&::-webkit-slider-thumb]:rounded-full',
  '[&::-webkit-slider-thumb]:bg-mint',
  '[&::-webkit-slider-thumb]:shadow-mid',
  '[&::-webkit-slider-thumb]:cursor-pointer',
  // Firefox
  '[&::-moz-range-thumb]:appearance-none',
  '[&::-moz-range-thumb]:rounded-full',
  '[&::-moz-range-thumb]:bg-mint',
  '[&::-moz-range-thumb]:shadow-mid',
  '[&::-moz-range-thumb]:cursor-pointer',
  '[&::-moz-range-thumb]:border-0',
].join(' ');

const INPUT_BASE_CLASSES = [
  'block w-full appearance-none rounded-pill cursor-pointer',
  'focus:outline-none',
  'focus-visible:ring-2 focus-visible:ring-mint focus-visible:ring-offset-2 focus-visible:ring-offset-canvas-0',
  'disabled:opacity-50 disabled:cursor-not-allowed',
].join(' ');

// 1.0 sits at (1.0 - 0.2) / (1.5 - 0.2) = 0.6154 of the scale, so
// the centered scale label needs an absolute position at 61.54%.
// Hard-coded as a constant to avoid runtime arithmetic that would
// produce the same number every render.
const MIDPOINT_LABEL_LEFT_PCT = 61.54;

export const PortionFactorSlider = forwardRef<HTMLInputElement, PortionFactorSliderProps>(
  function PortionFactorSlider(
    { value, onChange, description, size = 'md', disabled, className, ...rest },
    ref
  ): JSX.Element {
    const label = getPortionLabel(value);
    const fillPct = ((value - MIN_PORTION) / (MAX_PORTION - MIN_PORTION)) * 100;
    const valuetext = `${value.toFixed(1)} — ${label}porsjon`;

    // The track-fill gradient stops at the current value-percentage
    // so the active portion (left of the thumb) reads as mint and
    // the inactive portion as stroke-strong. var(--mint) and
    // var(--stroke-strong) keep the gradient theme-aware.
    const inputStyle: CSSProperties = {
      background: `linear-gradient(to right, var(--mint) 0%, var(--mint) ${fillPct}%, var(--stroke-strong) ${fillPct}%, var(--stroke-strong) 100%)`,
    };

    const inputCls = [
      INPUT_BASE_CLASSES,
      TRACK_HEIGHT[size],
      THUMB_BASE_CLASSES,
      THUMB_SIZE_CLASSES[size],
    ].join(' ');

    const wrapperCls = ['flex flex-col gap-2', disabled ? 'opacity-50' : '', className]
      .filter(Boolean)
      .join(' ');

    return (
      <div className={wrapperCls}>
        {/* Numeric value + role label */}
        <div className="flex items-baseline gap-2">
          <span className={`font-display ${NUMERIC_TEXT_SIZE[size]} text-text-1`}>
            {value.toFixed(1)}
          </span>
          <span className="font-body text-meta text-text-2">{label}porsjon</span>
        </div>

        {/* Slider input — the visible track with thumb. */}
        <input
          ref={ref}
          type="range"
          min={MIN_PORTION}
          max={MAX_PORTION}
          step={STEP_PORTION}
          value={value}
          onChange={(e) => onChange(Number.parseFloat(e.target.value))}
          disabled={disabled}
          aria-valuetext={valuetext}
          style={inputStyle}
          className={inputCls}
          {...rest}
        />

        {/* Tick marks under the track. Major tick at 1.0 (voksen). */}
        <div className="relative h-2 w-full" aria-hidden="true">
          {TICK_VALUES.map((t) => {
            const pct = ((t - MIN_PORTION) / (MAX_PORTION - MIN_PORTION)) * 100;
            const isMajor = t === 1.0;
            return (
              <span
                key={t}
                style={{ left: `${pct}%` }}
                className={`absolute -translate-x-1/2 ${
                  isMajor ? 'h-2 w-0.5 bg-text-2' : 'h-1 w-px bg-stroke-strong'
                }`}
              />
            );
          })}
        </div>

        {/* Scale labels (0.2 / 1.0 / 1.5). 1.0 emphasised because it is
            the voksen default and the visual anchor of the scale. */}
        <div className="relative h-4 font-body text-meta text-text-3" aria-hidden="true">
          <span className="absolute left-0">0.2</span>
          <span
            style={{ left: `${MIDPOINT_LABEL_LEFT_PCT}%`, transform: 'translateX(-50%)' }}
            className="absolute font-medium text-text-2"
          >
            1.0
          </span>
          <span className="absolute right-0">1.5</span>
        </div>

        {/* Description — locked-in default, override via prop. */}
        <p className="font-body text-meta text-text-2">{description ?? DEFAULT_DESCRIPTION}</p>
      </div>
    );
  }
);
