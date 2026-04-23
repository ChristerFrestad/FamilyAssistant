import { Routes, Route, Link } from 'react-router-dom';

// Fase 1a — "Hello v2" landing page verifies that:
//   1. Vite build emits correct asset paths with base: '/v2/'
//   2. Express's tryServeV2App handler serves index.html at /v2/
//   3. React Router handles client-side routing under /v2/
//   4. Unknown sub-paths (like /v2/nonsense) fall back to index.html
//      and the 404 route below takes over.
//
// Design tokens + app-shell + real screens land in Fase 1b / 1c / 1d.

function Home(): JSX.Element {
  return (
    <main style={{ padding: '2rem', maxWidth: '640px', margin: '0 auto' }}>
      <h1 style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>
        Familieassistenten <span style={{ opacity: 0.6 }}>v2</span>
      </h1>
      <p style={{ opacity: 0.8, lineHeight: 1.6 }}>
        Ny frontend under bygging. Denne siden bekrefter at Vite-bygget og Express-routingen
        fungerer. Design-tokens, komponenter og skjermer kommer i senere faser.
      </p>
      <nav style={{ marginTop: '2rem', display: 'flex', gap: '1rem' }}>
        <Link to="/" style={{ color: '#6ee7b7' }}>
          Hjem
        </Link>
        <Link to="/routing-test" style={{ color: '#6ee7b7' }}>
          Test client-side routing
        </Link>
      </nav>
      <footer style={{ marginTop: '3rem', opacity: 0.5, fontSize: '0.85rem' }}>
        Fase 1a — toolchain + shell. Kommer: design-system, i18n, nav.
      </footer>
    </main>
  );
}

function RoutingTest(): JSX.Element {
  return (
    <main style={{ padding: '2rem', maxWidth: '640px', margin: '0 auto' }}>
      <h1 style={{ fontSize: '1.5rem' }}>Client-side routing virker ✓</h1>
      <p style={{ opacity: 0.8 }}>
        Denne siden er ikke en fysisk fil på serveren. Express falt tilbake til
        <code> public/v2/index.html</code> og React Router rutet deg hit.
      </p>
      <Link to="/" style={{ color: '#6ee7b7' }}>
        ← Tilbake
      </Link>
    </main>
  );
}

function NotFound(): JSX.Element {
  return (
    <main style={{ padding: '2rem', maxWidth: '640px', margin: '0 auto' }}>
      <h1 style={{ fontSize: '1.5rem' }}>404 — ikke funnet</h1>
      <p style={{ opacity: 0.8 }}>Denne ruten finnes ikke i v2.</p>
      <Link to="/" style={{ color: '#6ee7b7' }}>
        ← Tilbake til forsiden
      </Link>
    </main>
  );
}

export default function App(): JSX.Element {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/routing-test" element={<RoutingTest />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
