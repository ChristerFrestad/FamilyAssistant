// Aggregator for the "Components" preview section. Keeps each
// per-component preview in its own file so the section grows without
// turning into a 600-line dump. The hash anchor `#components` matches
// the entry in PreviewPage.tsx's nav.

import AvatarPreview from './Avatar';
import BadgePreview from './Badge';
import ButtonPreview from './Button';
import CardPreview from './Card';
import CopyButtonPreview from './CopyButton';
import FieldPreview from './Field';
import InputPreview from './Input';
import PageShellPreview from './PageShell';
import PortionFactorSliderPreview from './PortionFactorSlider';
import ProgressDotsPreview from './ProgressDots';
import RowPreview from './Row';
import StackPreview from './Stack';
import TagPreview from './Tag';
import TermPreview from './Term';
import TogglePreview from './Toggle';

export default function Components(): JSX.Element {
  return (
    <section id="components" className="space-y-8">
      <h2 className="font-display text-display-md text-text-1">Components</h2>
      {/* Action */}
      <ButtonPreview />
      <CopyButtonPreview />
      {/* Form controls */}
      <InputPreview />
      <FieldPreview />
      <TogglePreview />
      <PortionFactorSliderPreview />
      {/* Layout */}
      <CardPreview />
      <StackPreview />
      <RowPreview />
      <PageShellPreview />
      {/* Display */}
      <AvatarPreview />
      <BadgePreview />
      <TagPreview />
      <ProgressDotsPreview />
      <TermPreview />
    </section>
  );
}
