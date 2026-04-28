// Placeholder root component for v2. Phase 1a proved the toolchain
// (Vite + React + TS + Tailwind) end-to-end with a landing page that
// exercised React Router and the Express /v2/* fallback. Phase 1b.1
// strips that back to a single "Kommer snart" view so design-tokens
// (1b.2) and base components (1b.3) can land against a clean slate.
//
// React Router is still mounted from main.tsx, so /v2/anything still
// resolves via the SPA fallback. This component does not declare any
// Routes — it simply renders regardless of the pathname.

export default function App(): JSX.Element {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2rem',
        textAlign: 'center',
      }}
    >
      <div style={{ maxWidth: '420px' }}>
        <h1 style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>
          Familieassistenten <span style={{ opacity: 0.55 }}>v2</span>
        </h1>
        <p style={{ opacity: 0.75, lineHeight: 1.55, margin: 0 }}>Kommer snart.</p>
      </div>
    </main>
  );
}
