// ProgressDots preview — 3-, 5-, and 7-step examples with a
// representative current step in each, plus all three sizes shown
// at the same step count so the dimensions are comparable.

import {
  ProgressDots,
  type ProgressDotsSize,
} from '../../../../app/components/display/ProgressDots';

const SIZES: ProgressDotsSize[] = ['sm', 'md', 'lg'];

export default function ProgressDotsPreview(): JSX.Element {
  return (
    <div className="space-y-4">
      <h3 className="font-body text-meta tracking-wide text-text-2 uppercase">ProgressDots</h3>

      {/* Step counts */}
      <div className="bg-canvas-1 rounded-md border border-stroke p-4 space-y-3">
        <code className="font-mono text-label text-text-3 block">step counts</code>
        <div className="flex flex-wrap items-center gap-6">
          <div className="flex items-center gap-2">
            <ProgressDots total={3} current={2} />
            <code className="font-mono text-label text-text-3">3 / current=2</code>
          </div>
          <div className="flex items-center gap-2">
            <ProgressDots total={5} current={3} />
            <code className="font-mono text-label text-text-3">5 / current=3</code>
          </div>
          <div className="flex items-center gap-2">
            <ProgressDots total={7} current={5} />
            <code className="font-mono text-label text-text-3">7 / current=5</code>
          </div>
        </div>
      </div>

      {/* Sizes */}
      <div className="bg-canvas-1 rounded-md border border-stroke p-4 space-y-3">
        <code className="font-mono text-label text-text-3 block">sizes</code>
        <div className="flex flex-wrap items-center gap-6">
          {SIZES.map((s) => (
            <div key={s} className="flex items-center gap-2">
              <ProgressDots total={5} current={3} size={s} />
              <code className="font-mono text-label text-text-3">{s}</code>
            </div>
          ))}
        </div>
      </div>

      {/* States grid: first / middle / last current */}
      <div className="bg-canvas-1 rounded-md border border-stroke p-4 space-y-3">
        <code className="font-mono text-label text-text-3 block">
          first / middle / last current
        </code>
        <div className="flex flex-wrap items-center gap-6">
          <ProgressDots total={5} current={1} />
          <ProgressDots total={5} current={3} />
          <ProgressDots total={5} current={5} />
        </div>
      </div>
    </div>
  );
}
