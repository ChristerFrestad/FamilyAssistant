// Visualises every meaningful Field state — bare label, with hint,
// with error, with required, and the generic-children pattern that
// lets Field wrap a textarea. Inputs use Tailwind utilities directly
// here because we have not built a dedicated Input component yet; in
// later phases these will be replaced with `<Input />` etc.

import { Field } from '../../../../app/components/form/Field';

const INPUT_CLS =
  'rounded-md border border-stroke bg-canvas-0 px-3 py-2 text-body text-text-1 ' +
  'focus:outline-none focus:border-stroke-strong';

const INPUT_ERROR_CLS =
  'rounded-md border border-rose bg-canvas-0 px-3 py-2 text-body text-text-1 ' +
  'focus:outline-none focus:border-rose';

export default function FieldPreview(): JSX.Element {
  return (
    <div className="space-y-4">
      <h3 className="font-body text-meta tracking-wide text-text-2 uppercase">Field</h3>

      <div className="bg-canvas-1 rounded-md border border-stroke p-4 grid gap-4 sm:grid-cols-2">
        <Field label="E-post">
          <input type="email" placeholder="navn@eksempel.no" className={INPUT_CLS} />
        </Field>

        <Field label="E-post" hint="Vi sender bekreftelseslenke hit">
          <input type="email" placeholder="navn@eksempel.no" className={INPUT_CLS} />
        </Field>

        <Field label="E-post" error="Ugyldig e-postadresse">
          <input type="email" defaultValue="ikke-en-epost" className={INPUT_ERROR_CLS} />
        </Field>

        <Field label="Familienavn" required hint="Vises på dashbordet">
          <input type="text" placeholder="F.eks. Hansen" className={INPUT_CLS} />
        </Field>

        <div className="sm:col-span-2">
          <Field label="Notater" hint="Wraps any element — here it is a <textarea>">
            <textarea rows={3} placeholder="Frivillig notat" className={INPUT_CLS} />
          </Field>
        </div>
      </div>
    </div>
  );
}
