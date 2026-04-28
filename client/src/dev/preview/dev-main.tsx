import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import PreviewPage from './PreviewPage';
// Importing app/styles from a dev-folder file is allowed: the
// enforce-dev-isolation plugin only restricts app -> dev imports,
// not dev -> app. The preview needs the real tokens.css + globals.css
// so it shows the same design system the production app uses.
import '../../app/styles/globals.css';
import '../../app/styles/tokens.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root not found in dev.html');
}

createRoot(rootElement).render(
  <StrictMode>
    <PreviewPage />
  </StrictMode>
);
