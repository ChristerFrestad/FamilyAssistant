// Aggregator for the "Components" preview section. Keeps each
// per-component preview in its own file so the section grows without
// turning into a 600-line dump. The hash anchor `#components` matches
// the entry in PreviewPage.tsx's nav.

import ButtonPreview from './Button';
import FieldPreview from './Field';

export default function Components(): JSX.Element {
  return (
    <section id="components" className="space-y-8">
      <h2 className="font-display text-display-md text-text-1">Components</h2>
      <ButtonPreview />
      <FieldPreview />
    </section>
  );
}
