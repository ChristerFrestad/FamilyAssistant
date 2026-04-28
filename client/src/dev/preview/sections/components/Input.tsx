// Standalone preview for the Input component — variants that the
// Field-composition view does not exercise on its own. Sizes are
// shown on the same row so a designer can compare vertical rhythm
// against Button at the same size scale.

import { Input } from '../../../../app/components/form/Input';

export default function InputPreview(): JSX.Element {
  return (
    <div className="space-y-4">
      <h3 className="font-body text-meta tracking-wide text-text-2 uppercase">
        Input (standalone)
      </h3>

      {/* Sizes */}
      <div className="bg-canvas-1 rounded-md border border-stroke p-4 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <code className="font-mono text-label text-text-3 min-w-[6rem]">size=sm</code>
          <Input size="sm" placeholder="Small" />
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <code className="font-mono text-label text-text-3 min-w-[6rem]">size=md</code>
          <Input size="md" placeholder="Medium (default)" />
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <code className="font-mono text-label text-text-3 min-w-[6rem]">size=lg</code>
          <Input size="lg" placeholder="Large" />
        </div>
      </div>

      {/* Common types */}
      <div className="bg-canvas-1 rounded-md border border-stroke p-4 grid gap-3 sm:grid-cols-2">
        <div>
          <code className="font-mono text-label text-text-3 block mb-1">type=text</code>
          <Input type="text" placeholder="Tekst" />
        </div>
        <div>
          <code className="font-mono text-label text-text-3 block mb-1">type=email</code>
          <Input type="email" placeholder="navn@eksempel.no" />
        </div>
        <div>
          <code className="font-mono text-label text-text-3 block mb-1">type=password</code>
          <Input type="password" placeholder="********" />
        </div>
        <div>
          <code className="font-mono text-label text-text-3 block mb-1">type=number</code>
          <Input type="number" placeholder="0" />
        </div>
      </div>

      {/* States */}
      <div className="bg-canvas-1 rounded-md border border-stroke p-4 space-y-3">
        <div>
          <code className="font-mono text-label text-text-3 block mb-1">default</code>
          <Input placeholder="Idle state" />
        </div>
        <div>
          <code className="font-mono text-label text-text-3 block mb-1">disabled</code>
          <Input disabled defaultValue="Cannot edit" />
        </div>
        <div>
          <code className="font-mono text-label text-text-3 block mb-1">aria-invalid</code>
          <Input aria-invalid defaultValue="bad value" />
        </div>
      </div>
    </div>
  );
}
