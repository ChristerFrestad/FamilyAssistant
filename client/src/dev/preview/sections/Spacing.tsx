// Tailwind's default 4 px base unit (1 = 0.25 rem) maps 1:1 to
// tokens.css's --space-* scale, so the visualisation here uses
// Tailwind's `w-N` width utility directly. The label shows both
// the Tailwind class and the resolved pixel value so a designer
// can pick either when building components.

type Step = {
  cls: string;
  /** Width in pixels at the default 16 px root font size. */
  px: number;
};

const STEPS: Step[] = [
  { cls: 'w-1', px: 4 },
  { cls: 'w-2', px: 8 },
  { cls: 'w-3', px: 12 },
  { cls: 'w-4', px: 16 },
  { cls: 'w-5', px: 20 },
  { cls: 'w-6', px: 24 },
  { cls: 'w-8', px: 32 },
  { cls: 'w-10', px: 40 },
  { cls: 'w-12', px: 48 },
];

export default function Spacing(): JSX.Element {
  return (
    <section id="spacing" className="space-y-4">
      <h2 className="font-display text-display-md text-text-1">Spacing</h2>
      <p className="font-body text-meta text-text-2">
        Tailwind&apos;s default scale (1 = 0.25 rem = 4 px) is in lockstep with the --space-* tokens
        in tokens.css. Use the Tailwind class for components and the token for arbitrary CSS.
      </p>
      <div className="bg-canvas-1 rounded-md border border-stroke p-4 space-y-2">
        {STEPS.map((s) => (
          <div key={s.cls} className="flex items-center gap-4">
            <code className="font-mono text-meta text-text-1 min-w-[3rem]">{s.cls}</code>
            <div className={`${s.cls} h-4 bg-mint rounded-sm`} aria-hidden />
            <code className="font-mono text-label text-text-3">{s.px} px</code>
          </div>
        ))}
      </div>
    </section>
  );
}
