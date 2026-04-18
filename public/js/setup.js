/* eslint-disable no-undef, no-unused-vars -- browser context, standalone bundle */
// Phase 22 — setup wizard client. Runs only when the server is in
// BOOTSTRAP_MODE. Orchestrates:
//   1. GET /api/bootstrap/status  — determine whether to show the form
//      or redirect back to the main app
//   2. POST /api/bootstrap/generate-token — server-side random token
//   3. POST /api/bootstrap/complete — persist the values, then poll
//      /health until the restarted container is back up

(function () {
  'use strict';

  const els = {
    statusNote: document.getElementById('statusNote'),
    form: document.getElementById('setupForm'),
    token: document.getElementById('authToken'),
    origins: document.getElementById('allowedOrigins'),
    llm: document.getElementById('llmBackend'),
    ollama: document.getElementById('ollamaHost'),
    log: document.getElementById('logLevel'),
    submit: document.getElementById('submitBtn'),
    gen: document.getElementById('genBtn'),
    status: document.getElementById('status'),
    restartPanel: document.getElementById('restartPanel'),
    alreadyPanel: document.getElementById('alreadyPanel'),
  };

  function setStatus(text, kind) {
    els.status.textContent = text || '';
    els.status.className = 'status' + (kind ? ' ' + kind : '');
  }

  function setNote(text, kind) {
    els.statusNote.textContent = text;
    if (kind === 'ok') {
      els.statusNote.style.background = '#d1fae5';
      els.statusNote.style.borderLeftColor = '#059669';
    } else if (kind === 'err') {
      els.statusNote.style.background = '#fee2e2';
      els.statusNote.style.borderLeftColor = '#dc2626';
    }
  }

  async function init() {
    try {
      const res = await fetch('/api/bootstrap/status');
      const data = await res.json();
      if (data.mode === 'bootstrap') {
        els.statusNote.hidden = true;
        els.form.hidden = false;
        // Pre-fill origins with the current browser origin as a hint.
        if (!els.origins.value && location.origin) {
          els.origins.value = location.origin;
        }
      } else {
        els.statusNote.hidden = true;
        els.alreadyPanel.hidden = false;
      }
    } catch (err) {
      setNote('Could not reach the server: ' + err.message, 'err');
    }
  }

  async function generateToken() {
    els.gen.disabled = true;
    try {
      const res = await fetch('/api/bootstrap/generate-token', { method: 'POST' });
      if (!res.ok) throw new Error('Server returned ' + res.status);
      const data = await res.json();
      els.token.value = data.token;
      setStatus('Token generated server-side (32 hex chars).', 'ok');
    } catch (err) {
      // Fallback to client-side crypto if the server call fails.
      const buf = new Uint8Array(32);
      window.crypto.getRandomValues(buf);
      els.token.value = Array.from(buf)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      setStatus('Token generated locally (fallback).', 'ok');
    } finally {
      els.gen.disabled = false;
    }
  }

  async function submitSetup(ev) {
    ev.preventDefault();
    setStatus('Saving…');
    els.submit.disabled = true;

    const payload = {
      authToken: els.token.value.trim(),
      allowedOrigins: els.origins.value.trim(),
      llmBackend: els.llm.value,
      ollamaHost: els.ollama.value.trim(),
      logLevel: els.log.value,
    };

    try {
      const res = await fetch('/api/bootstrap/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus('Setup failed: ' + (data.detail || res.statusText), 'err');
        els.submit.disabled = false;
        return;
      }
      els.form.hidden = true;
      els.restartPanel.hidden = false;
      waitForRestart();
    } catch (err) {
      setStatus('Network error: ' + err.message, 'err');
      els.submit.disabled = false;
    }
  }

  async function waitForRestart() {
    // The server is about to exit; give it a moment before polling.
    await new Promise((r) => setTimeout(r, 4000));
    for (let i = 0; i < 30; i++) {
      try {
        const res = await fetch('/health', { cache: 'no-store' });
        if (res.ok) {
          window.location.replace('/');
          return;
        }
      } catch {
        // still down
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    // Timed out — let the user reload manually.
    els.restartPanel.innerHTML =
      '<h2>Setup saved</h2><p>Container did not come back up within a minute. ' +
      'Check the Portainer logs and reload manually when ready.</p>';
  }

  els.gen.addEventListener('click', generateToken);
  els.form.addEventListener('submit', submitSetup);
  init();
})();
