// Visualises the Stack layout primitive — gap scale and align modes.
// Stack containers wear a dashed stroke-strong border so the layout
// boundary is visible against the canvas; the children are uniform
// mint blocks so the eye reads the spacing/alignment, not the
// children themselves.

import { Stack, type StackAlign, type StackGap } from '../../../../app/components/layout/Stack';

const GAPS: StackGap[] = ['xs', 'sm', 'md', 'lg', 'xl'];
const ALIGNS: StackAlign[] = ['start', 'center', 'end', 'stretch'];

function Block({ width = 'w-32' }: { width?: string }): JSX.Element {
  return <div className={`${width} h-6 rounded-sm bg-mint`} aria-hidden="true" />;
}

export default function StackPreview(): JSX.Element {
  return (
    <div className="space-y-4">
      <h3 className="font-body text-meta tracking-wide text-text-2 uppercase">Stack (vertical)</h3>

      {/* Gap scale */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {GAPS.map((g) => (
          <div key={g} className="space-y-2">
            <code className="font-mono text-label text-text-3 block">gap={g}</code>
            <Stack gap={g} className="border border-dashed border-stroke-strong p-2 rounded-md">
              <Block />
              <Block />
              <Block />
            </Stack>
          </div>
        ))}
      </div>

      {/* Align modes (cross-axis = horizontal in flex-col) */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {ALIGNS.map((a) => (
          <div key={a} className="space-y-2">
            <code className="font-mono text-label text-text-3 block">align={a}</code>
            <Stack
              align={a}
              gap="sm"
              className="border border-dashed border-stroke-strong p-2 rounded-md w-full"
            >
              {/* Vary widths so cross-axis alignment is visible. The
                  stretch case overrides any width-x via items-stretch
                  and the children fill the cross-axis. */}
              <Block width={a === 'stretch' ? 'w-auto' : 'w-16'} />
              <Block width={a === 'stretch' ? 'w-auto' : 'w-24'} />
              <Block width={a === 'stretch' ? 'w-auto' : 'w-12'} />
            </Stack>
          </div>
        ))}
      </div>
    </div>
  );
}
