import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';

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
