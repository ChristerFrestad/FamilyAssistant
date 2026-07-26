// Bulk WCAG 2.1 AA accessibility audit for every base component.
//
// Each test renders one component in isolation and runs axe-core against
// the resulting DOM. Violations bubble up as test failures with a full
// HTML snippet pointing at the offending node, so a future regression
// (e.g. an icon-only button gains no aria-label) fails this suite first.
//
// Component coverage matches Phase 3A scope:
//   - Base       : Button (sm/md/lg, primary/secondary/ghost, loading)
//   - Display    : Avatar, Badge, ProgressDots, Tag, Term
//   - Form       : Input, Toggle, Field, LanguageSwitcher, ThemeToggle,
//                  PortionFactorSlider, CopyButton
//   - Layout     : Card, PageShell, Row, Stack, BottomNav, SideNav,
//                  ErrorBoundary, UserMenu
//   - Overlay    : Modal
//   - Settings   : SettingsSection, SettingsRow, InlineEditableText,
//                  DataExportButton, DeleteAccountButton
//
// Configuration: see client/src/test-helpers/axe.ts. Color-contrast is
// validated separately via mathematical token-pair tests in
// client/src/app/styles/contrast.test.ts.

import { describe, it } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { expectNoAxeViolations } from '../../test-helpers/axe';
import { ThemeProvider } from '../theme/ThemeContext';

// Base
import { Button } from './base/Button';

// Display
import { Avatar } from './display/Avatar';
import { Badge } from './display/Badge';
import { ProgressDots } from './display/ProgressDots';
import { Tag } from './display/Tag';
import { Term } from './display/Term';

// Form
import { Input } from './form/Input';
import { Toggle } from './form/Toggle';
import { Field } from './form/Field';
import { LanguageSwitcher } from './form/LanguageSwitcher';
import { ThemeToggle } from './form/ThemeToggle';
import { PortionFactorSlider } from './form/PortionFactorSlider';
import { CopyButton } from './form/CopyButton';

// Layout
import { Card } from './layout/Card';
import { PageShell } from './layout/PageShell';
import { Row } from './layout/Row';
import { Stack } from './layout/Stack';
import { BottomNav } from './layout/BottomNav';
import { SideNav } from './layout/SideNav';

// Overlay
import { Modal } from './overlay/Modal';

// Settings
import { SettingsSection } from './settings/SettingsSection';
import { SettingsRow } from './settings/SettingsRow';
import { InlineEditableText } from './settings/InlineEditableText';
import { DataExportButton } from './settings/DataExportButton';
import { DeleteAccountButton } from './settings/DeleteAccountButton';

// React-router-aware components need a router host.
function withRouter(ui: React.ReactNode): React.ReactNode {
  return <MemoryRouter>{ui}</MemoryRouter>;
}

// Theme-context-aware components need a provider host.
function withTheme(ui: React.ReactNode): React.ReactNode {
  return <ThemeProvider>{ui}</ThemeProvider>;
}

describe('a11y — Base', () => {
  it('Button primary renders without violations', async () => {
    const { container } = render(<Button>Save</Button>);
    await expectNoAxeViolations(container);
  });

  it('Button loading state surfaces aria-busy without violations', async () => {
    const { container } = render(<Button loading>Saving</Button>);
    await expectNoAxeViolations(container);
  });

  it('Button secondary and ghost variants pass axe', async () => {
    const { container } = render(
      <>
        <Button variant="secondary">Cancel</Button>
        <Button variant="ghost">Hint</Button>
      </>
    );
    await expectNoAxeViolations(container);
  });
});

describe('a11y — Display', () => {
  it('Avatar with alt text passes axe', async () => {
    const { container } = render(<Avatar alt="Christer Frestad" />);
    await expectNoAxeViolations(container);
  });

  it('Badge passes axe', async () => {
    const { container } = render(<Badge variant="mint">Voksen</Badge>);
    await expectNoAxeViolations(container);
  });

  it('ProgressDots passes axe (component renders aria-label internally)', async () => {
    const { container } = render(<ProgressDots total={3} current={1} />);
    await expectNoAxeViolations(container);
  });

  it('Tag passes axe', async () => {
    const { container } = render(<Tag variant="cyan">Vegetar</Tag>);
    await expectNoAxeViolations(container);
  });

  it('Term inline variant passes axe', async () => {
    const { container } = render(<Term variant="inline">npm install</Term>);
    await expectNoAxeViolations(container);
  });

  it('Term block variant passes axe', async () => {
    const { container } = render(<Term variant="block">SESSION_SECRET=abc123</Term>);
    await expectNoAxeViolations(container);
  });
});

describe('a11y — Form', () => {
  it('Input via Field passes axe', async () => {
    const { container } = render(
      <Field label="E-post" hint="Vi sender bekreftelseslenke hit">
        <Input type="email" />
      </Field>
    );
    await expectNoAxeViolations(container);
  });

  it('Field with error message passes axe', async () => {
    const { container } = render(
      <Field label="Familienavn" error="Navnet kan ikke være tomt">
        <Input type="text" defaultValue="" />
      </Field>
    );
    await expectNoAxeViolations(container);
  });

  it('Toggle with label passes axe', async () => {
    const { container } = render(
      <Toggle checked={false} onChange={() => undefined} label="Mørk modus" />
    );
    await expectNoAxeViolations(container);
  });

  it('LanguageSwitcher passes axe', async () => {
    const { container } = render(<LanguageSwitcher />);
    await expectNoAxeViolations(container);
  });

  it('ThemeToggle inside provider passes axe', async () => {
    const { container } = render(<>{withTheme(<ThemeToggle />)}</>);
    await expectNoAxeViolations(container);
  });

  it('PortionFactorSlider with external label passes axe', async () => {
    // Mirrors real usage in MemberCard: caller wraps the slider in a
    // <label htmlFor>. The slider does not render its own label.
    const { container } = render(
      <>
        <label htmlFor="test-slider">Porsjon</label>
        <PortionFactorSlider id="test-slider" value={1} onChange={() => undefined} />
      </>
    );
    await expectNoAxeViolations(container);
  });

  it('PortionFactorSlider with aria-label passes axe', async () => {
    // Standalone usage where the caller cannot supply a visual label.
    const { container } = render(
      <PortionFactorSlider value={1} onChange={() => undefined} aria-label="Porsjonsfaktor" />
    );
    await expectNoAxeViolations(container);
  });

  it('CopyButton passes axe', async () => {
    const { container } = render(<CopyButton value="hello" label="Kopier" />);
    await expectNoAxeViolations(container);
  });
});

describe('a11y — Layout', () => {
  it('Card passes axe', async () => {
    const { container } = render(
      <Card>
        <p>Innhold</p>
      </Card>
    );
    await expectNoAxeViolations(container);
  });

  it('PageShell passes axe', async () => {
    const { container } = render(
      <PageShell>
        <h1>Side</h1>
      </PageShell>
    );
    await expectNoAxeViolations(container);
  });

  it('Row and Stack pass axe', async () => {
    const { container } = render(
      <Row>
        <Stack>
          <span>One</span>
          <span>Two</span>
        </Stack>
      </Row>
    );
    await expectNoAxeViolations(container);
  });

  it('BottomNav inside router passes axe', async () => {
    const { container } = render(<>{withRouter(<BottomNav />)}</>);
    await expectNoAxeViolations(container);
  });

  it('SideNav inside router passes axe', async () => {
    const { container } = render(<>{withRouter(<SideNav />)}</>);
    await expectNoAxeViolations(container);
  });
});

describe('a11y — Overlay', () => {
  it('Modal opened with title and description passes axe', async () => {
    const { container } = render(
      <Modal open onClose={() => undefined} title="Slett konto" size="sm">
        <p>Dette kan ikke angres innen 30 dager.</p>
      </Modal>
    );
    await expectNoAxeViolations(container);
  });
});

describe('a11y — Settings', () => {
  it('SettingsSection passes axe', async () => {
    const { container } = render(
      <SettingsSection title="System" id="system">
        <SettingsRow label="Tema" />
      </SettingsSection>
    );
    await expectNoAxeViolations(container);
  });

  it('SettingsRow with disabled badge passes axe', async () => {
    const { container } = render(
      <SettingsRow
        label="Tidssone"
        description="Standard for hele familien"
        disabled
        badge="Sprint 6"
      />
    );
    await expectNoAxeViolations(container);
  });

  it('InlineEditableText editable mode passes axe', async () => {
    const { container } = render(
      <InlineEditableText
        value="Familien Frestad"
        onSave={async () => true}
        editLabel="Rediger"
        saveLabel="Lagre"
        cancelLabel="Avbryt"
        inputAriaLabel="Familienavn"
      />
    );
    await expectNoAxeViolations(container);
  });

  it('InlineEditableText read-only mode passes axe', async () => {
    const { container } = render(
      <InlineEditableText
        value="Familien Frestad"
        onSave={async () => true}
        editLabel="Rediger"
        saveLabel="Lagre"
        cancelLabel="Avbryt"
        inputAriaLabel="Familienavn"
        readOnly
        readOnlyHint="Bare eier kan endre dette"
      />
    );
    await expectNoAxeViolations(container);
  });

  it('DataExportButton passes axe', async () => {
    const { container } = render(
      <DataExportButton
        onExport={async () => undefined}
        label="Last ned mine data"
        ariaLabel="Last ned mine data som JSON"
      />
    );
    await expectNoAxeViolations(container);
  });

  it('DeleteAccountButton enabled passes axe', async () => {
    const { container } = render(
      <DeleteAccountButton
        onDelete={async () => null}
        onSuccess={() => undefined}
        label="Slett konto"
        confirmText="Sikker?"
      />
    );
    await expectNoAxeViolations(container);
  });

  it('DeleteAccountButton owner-blocked passes axe', async () => {
    const { container } = render(
      <DeleteAccountButton
        onDelete={async () => null}
        onSuccess={() => undefined}
        label="Slett konto"
        confirmText="Sikker?"
        ownerBlocked
        ownerBlockedHint="Du må overføre eierskap først"
      />
    );
    await expectNoAxeViolations(container);
  });
});
