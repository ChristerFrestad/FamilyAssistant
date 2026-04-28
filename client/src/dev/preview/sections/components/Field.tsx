// Visualises every meaningful Field state — bare label, with hint,
// with error, with required, and the generic-children pattern that
// lets Field wrap a textarea. Inputs use the dedicated Input
// component now (Phase 1b.3 part 2 / Batch A); the error-state
// border is no longer specified inline — Field clones the child to
// inject aria-invalid="true" when error is set, and Input picks
// up the rose border from that attribute on its own.
//
// Textarea remains a plain <textarea> here to demonstrate that
// Field is not Input-specific — any element that accepts an `id`
// and the standard ARIA attributes works as a child. A future
// Textarea component will replace it without changing Field.

import { Field } from '../../../../app/components/form/Field';
import { Input } from '../../../../app/components/form/Input';

const TEXTAREA_CLS =
  'block w-full rounded-md border border-stroke bg-canvas-0 px-3 py-2 text-body ' +
  'text-text-1 placeholder:text-text-3 focus:outline-none ' +
  'focus-visible:ring-2 focus-visible:ring-mint focus-visible:ring-offset-2 ' +
  'focus-visible:ring-offset-canvas-0';

export default function FieldPreview(): JSX.Element {
  return (
    <div className="space-y-4">
      <h3 className="font-body text-meta tracking-wide text-text-2 uppercase">
        Field + Input composition
      </h3>

      <div className="bg-canvas-1 rounded-md border border-stroke p-4 grid gap-4 sm:grid-cols-2">
        <Field label="E-post">
          <Input type="email" placeholder="navn@eksempel.no" />
        </Field>

        <Field label="E-post" hint="Vi sender bekreftelseslenke hit">
          <Input type="email" placeholder="navn@eksempel.no" />
        </Field>

        <Field label="E-post" error="Ugyldig e-postadresse">
          <Input type="email" defaultValue="ikke-en-epost" />
        </Field>

        <Field label="Familienavn" required hint="Vises på dashbordet">
          <Input type="text" placeholder="F.eks. Hansen" />
        </Field>

        <div className="sm:col-span-2">
          <Field label="Notater" hint="Wraps any element — here it is a <textarea>">
            <textarea rows={3} placeholder="Frivillig notat" className={TEXTAREA_CLS} />
          </Field>
        </div>
      </div>
    </div>
  );
}
