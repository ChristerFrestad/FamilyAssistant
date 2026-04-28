// Visualises the Row layout primitive — gap, align, justify, and
// wrap. Same dashed-border + uniform-block pattern as Stack so the
// layout property under demonstration is the only visual variable.

import {
  Row,
  type RowAlign,
  type RowGap,
  type RowJustify,
} from '../../../../app/components/layout/Row';

const GAPS: RowGap[] = ['xs', 'sm', 'md', 'lg', 'xl'];
const ALIGNS: RowAlign[] = ['start', 'center', 'end', 'stretch'];
const JUSTIFIES: RowJustify[] = ['start', 'center', 'end', 'between', 'around'];

function Block({ height = 'h-6' }: { height?: string }): JSX.Element {
  return <div className={`w-12 ${height} rounded-sm bg-cyan`} aria-hidden="true" />;
}

export default function RowPreview(): JSX.Element {
  return (
    <div className="space-y-4">
      <h3 className="font-body text-meta tracking-wide text-text-2 uppercase">Row (horizontal)</h3>

      {/* Gap scale */}
      <div className="grid gap-3 sm:grid-cols-1">
        {GAPS.map((g) => (
          <div key={g} className="space-y-1">
            <code className="font-mono text-label text-text-3 block">gap={g}</code>
            <Row gap={g} className="border border-dashed border-stroke-strong p-2 rounded-md">
              <Block />
              <Block />
              <Block />
              <Block />
            </Row>
          </div>
        ))}
      </div>

      {/* Align modes (cross-axis = vertical in flex-row) */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {ALIGNS.map((a) => (
          <div key={a} className="space-y-1">
            <code className="font-mono text-label text-text-3 block">align={a}</code>
            <Row
              align={a}
              gap="sm"
              className="border border-dashed border-stroke-strong p-2 rounded-md h-20"
            >
              <Block height={a === 'stretch' ? 'h-full' : 'h-4'} />
              <Block height={a === 'stretch' ? 'h-full' : 'h-8'} />
              <Block height={a === 'stretch' ? 'h-full' : 'h-12'} />
            </Row>
          </div>
        ))}
      </div>

      {/* Justify modes (main-axis = horizontal in flex-row) */}
      <div className="grid gap-3 sm:grid-cols-1">
        {JUSTIFIES.map((j) => (
          <div key={j} className="space-y-1">
            <code className="font-mono text-label text-text-3 block">justify={j}</code>
            <Row
              justify={j}
              gap="xs"
              className="border border-dashed border-stroke-strong p-2 rounded-md w-full"
            >
              <Block />
              <Block />
              <Block />
            </Row>
          </div>
        ))}
      </div>

      {/* wrap */}
      <div className="space-y-1">
        <code className="font-mono text-label text-text-3 block">wrap=true</code>
        <Row
          wrap
          gap="sm"
          className="border border-dashed border-stroke-strong p-2 rounded-md w-72"
        >
          {Array.from({ length: 12 }).map((_, i) => (
            <Block key={i} />
          ))}
        </Row>
      </div>
    </div>
  );
}
