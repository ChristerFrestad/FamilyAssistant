import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './app/App';
// i18n config side-effect: registers resource bundles and the
// language detector with i18next. Imported here (and not lazily)
// so the very first render already has translations available.
import './app/i18n/config';
// Order matters: globals.css ships the Tailwind reset; tokens.css
// then defines the design system + body baseline that sits on top
// of that reset. tokens.css also pulls in the @font-face faces, so
// Vite emits the woff2 files as build assets next to the bundle.
import './app/styles/globals.css';
import './app/styles/tokens.css';

// `basename="/v2"` tells React Router that all routes are relative to
// /v2/*. This matches Vite's `base: '/v2/'` so internal links ("/") map
// to "/v2/" in the browser URL without extra code.
const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root not found');
}

createRoot(rootElement).render(
  <StrictMode>
    <BrowserRouter basename="/v2">
      <App />
    </BrowserRouter>
  </StrictMode>
);
