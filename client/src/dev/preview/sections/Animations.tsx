import { useState } from 'react';

// The four mockup animations as utility classes. Each animation has
// a "Replay" button that toggles the class off and on so the
// effect plays again — useful for staring at the timing curve.
//
// soft-pulse and wobble are infinite, so they are always running;
// the "Replay" for those is a no-op visual reset. slide-up and
// shake are one-shots — the button is genuinely useful for them.

type Anim = {
  cls: string;
  /** keyframe name as declared in tokens.css */
  keyframe: string;
  /** "infinite" or "one-shot" */
  kind: 'infinite' | 'one-shot';
  /** What the animation is used for in the production app */
  use: string;
};

const ANIMATIONS: Anim[] = [
  {
    cls: 'animate-soft-pulse',
    keyframe: 'softPulse',
    kind: 'infinite',
    use: 'Magic-link confirmation circle',
  },
  {
    cls: 'animate-slide-up',
    keyframe: 'slideUp',
    kind: 'one-shot',
    use: 'Screen entry transition',
  },
  {
    cls: 'animate-shake',
    keyframe: 'shake',
    kind: 'one-shot',
    use: 'Form-validation error',
  },
  {
    cls: 'animate-wobble',
    keyframe: 'wobble',
    kind: 'infinite',
    use: 'Error-state illustration',
  },
];

function AnimationCard(props: { anim: Anim }): JSX.Element {
  const [tick, setTick] = useState(0);
  return (
    <div className="bg-bg-1 rounded-md border border-stroke p-4 space-y-3">
      <div>
        <code className="font-mono text-meta text-text-1 block">{props.anim.cls}</code>
        <code className="font-mono text-label text-text-3 block">
          @keyframes {props.anim.keyframe} ({props.anim.kind})
        </code>
        <p className="font-body text-meta text-text-2 mt-1">{props.anim.use}</p>
      </div>
      <div className="flex items-center gap-4">
        <div
          // Bumping `key` forces React to drop and re-mount the node,
          // restarting any one-shot animation cleanly.
          key={tick}
          className={`${props.anim.cls} w-12 h-12 rounded-pill bg-mint`}
          aria-hidden
        />
        <button
          type="button"
          onClick={() => setTick((t) => t + 1)}
          className="rounded-md bg-ink text-ink-contrast font-body text-meta px-3 py-2"
        >
          Replay
        </button>
      </div>
    </div>
  );
}

export default function Animations(): JSX.Element {
  return (
    <section id="animations" className="space-y-4">
      <h2 className="font-display text-display-md text-text-1">Animations</h2>
      <p className="font-body text-meta text-text-2">
        prefers-reduced-motion disables all four animations and the theme transition globally.
        Toggle your OS reduced-motion preference and reload to verify.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {ANIMATIONS.map((a) => (
          <AnimationCard key={a.cls} anim={a} />
        ))}
      </div>
    </section>
  );
}
