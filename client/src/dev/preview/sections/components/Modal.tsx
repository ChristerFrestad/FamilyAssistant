import type { JSX } from 'react';
// Modal preview — five interactive examples that exercise the
// behavior of every prop on a real DOM. The modal mounts to
// document.body via createPortal, so opening one in the preview
// genuinely overlays the entire viewport (not just the section
// container) and we get to see scroll-lock + focus-trap actually
// engage.
//
// We use co-located useState rather than a single shared open-flag
// so the buttons can be clicked independently — opening one modal
// does not auto-close another.

import { useState } from 'react';
import { Button } from '../../../../app/components/base/Button';
import { Field } from '../../../../app/components/form/Field';
import { Input } from '../../../../app/components/form/Input';
import { Modal } from '../../../../app/components/overlay/Modal';

export default function ModalPreview(): JSX.Element {
  const [centerOpen, setCenterOpen] = useState(false);
  const [bottomOpen, setBottomOpen] = useState(false);
  const [noCloseOpen, setNoCloseOpen] = useState(false);
  const [fullOpen, setFullOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);

  return (
    <div className="space-y-4">
      <h3 className="font-body text-meta tracking-wide text-text-2 uppercase">Modal</h3>

      {/* Center modal with title + description (the "default" usage) */}
      <div className="bg-canvas-1 rounded-md border border-stroke p-4 space-y-3">
        <code className="font-mono text-label text-text-3 block">
          center (default) — title + description
        </code>
        <Button onClick={() => setCenterOpen(true)}>Åpne center modal</Button>
        <Modal
          open={centerOpen}
          onClose={() => setCenterOpen(false)}
          title="Bekreft handling"
          description="Denne handlingen kan ikke angres. Vil du fortsette?"
        >
          <p className="font-body text-body text-text-1">
            Modal-innholdet kan være hva som helst. Backdrop-klikk og Escape lukker.
          </p>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setCenterOpen(false)}>
              Avbryt
            </Button>
            <Button onClick={() => setCenterOpen(false)}>Bekreft</Button>
          </div>
        </Modal>
      </div>

      {/* Bottom sheet — same component, position="bottom" */}
      <div className="bg-canvas-1 rounded-md border border-stroke p-4 space-y-3">
        <code className="font-mono text-label text-text-3 block">
          position=&quot;bottom&quot; (sheet) — slides up from viewport edge
        </code>
        <Button onClick={() => setBottomOpen(true)}>Åpne bottom sheet</Button>
        <Modal
          open={bottomOpen}
          onClose={() => setBottomOpen(false)}
          position="bottom"
          title="Velg handling"
        >
          <ul className="font-body text-body text-text-1 space-y-2">
            <li>
              <button
                type="button"
                onClick={() => setBottomOpen(false)}
                className="w-full text-left px-3 py-2 rounded-md hover:bg-surface"
              >
                Rediger
              </button>
            </li>
            <li>
              <button
                type="button"
                onClick={() => setBottomOpen(false)}
                className="w-full text-left px-3 py-2 rounded-md hover:bg-surface"
              >
                Del
              </button>
            </li>
            <li>
              <button
                type="button"
                onClick={() => setBottomOpen(false)}
                className="w-full text-left px-3 py-2 rounded-md hover:bg-surface text-rose"
              >
                Slett
              </button>
            </li>
          </ul>
        </Modal>
      </div>

      {/* No close button — modal must be closed via backdrop / Escape /
          a custom action button. Useful for "are you sure?" flows. */}
      <div className="bg-canvas-1 rounded-md border border-stroke p-4 space-y-3">
        <code className="font-mono text-label text-text-3 block">
          showCloseButton=&#123;false&#125; — close via action only
        </code>
        <Button onClick={() => setNoCloseOpen(true)}>Åpne uten X</Button>
        <Modal
          open={noCloseOpen}
          onClose={() => setNoCloseOpen(false)}
          showCloseButton={false}
          title="Ingen X-knapp"
          description="Lukk via knappen under, backdrop, eller Escape."
        >
          <Button onClick={() => setNoCloseOpen(false)}>Forstått</Button>
        </Modal>
      </div>

      {/* Full size — wider panel for forms / multi-section content */}
      <div className="bg-canvas-1 rounded-md border border-stroke p-4 space-y-3">
        <code className="font-mono text-label text-text-3 block">
          size=&quot;full&quot; — wider panel for richer content
        </code>
        <Button onClick={() => setFullOpen(true)}>Åpne full-size modal</Button>
        <Modal
          open={fullOpen}
          onClose={() => setFullOpen(false)}
          size="full"
          title="Full size"
          description="Maks-bredde 2xl — passer til skjemaer og flersnitt-innhold."
        >
          <div className="font-body text-body text-text-1 space-y-3">
            <p>
              Full-size beholder gir plass til lengre tekst, flere kolonner, eller komponenter som
              ProgressDots og lignende uten å føles trang.
            </p>
            <p>
              Maks-høyden er fortsatt 90 vh, så lange innhold scrolles inne i modalen uten at
              backdroppet røres.
            </p>
          </div>
        </Modal>
      </div>

      {/* Form inside modal — exercises focus-trap with multiple
          focusable elements + the auto-focus-first behavior. */}
      <div className="bg-canvas-1 rounded-md border border-stroke p-4 space-y-3">
        <code className="font-mono text-label text-text-3 block">
          form-eksempel — Field + Input + Button inni modal
        </code>
        <Button onClick={() => setFormOpen(true)}>Åpne skjema-modal</Button>
        <Modal
          open={formOpen}
          onClose={() => setFormOpen(false)}
          title="Inviter familiemedlem"
          description="Sender en magisk lenke til denne adressen."
        >
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              setFormOpen(false);
            }}
          >
            <Field label="E-post" hint="Vi sender bekreftelseslenke hit">
              <Input type="email" placeholder="navn@eksempel.no" />
            </Field>
            <Field label="Navn (valgfritt)">
              <Input type="text" placeholder="Lise" />
            </Field>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" type="button" onClick={() => setFormOpen(false)}>
                Avbryt
              </Button>
              <Button type="submit">Send invitasjon</Button>
            </div>
          </form>
        </Modal>
      </div>
    </div>
  );
}
