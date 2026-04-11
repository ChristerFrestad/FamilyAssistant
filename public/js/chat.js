/* eslint-disable no-undef, no-unused-vars, no-empty, no-redeclare, no-prototype-builtins -- classic script shares globals across public/js/*.js, see week-3 modularization */
// === CHAT / STEMME / KB ===
let chatHistory = [];
let isRecording = false;
let recognition = null;

async function checkLlmStatus() {
  try {
    const data = await api('/api/llm/status');
    const el = document.getElementById('llmStatus');
    if (data.available) {
      const sttText = data.stt?.available ? ` · STT: ${data.stt.backend}` : ' · STT: nettleser';
      const kbText = data.kb ? ` · KB: ${data.kb.totalInteractions} samtaler` : '';
      el.textContent = `🟢 ${data.model} via ${data.backend || 'ollama'}${sttText}${kbText}`;
      el.style.color = 'var(--green)';
    } else {
      el.textContent = '🟡 LLM ikke tilgjengelig — grunnfunksjoner aktive, smarte forslag deaktivert';
      el.style.color = 'var(--yellow)';
    }
  } catch {
    document.getElementById('llmStatus').textContent = '🔴 Kunne ikke sjekke LLM-status';
  }
}

function addChatBubble(text, sender, extraRawHtml) {
  const container = document.getElementById('chatMessages');
  const cls = sender === 'user' ? 'chat-msg-user' : 'chat-msg-ai';
  // extraRawHtml antas trygg (bygges av oss, ikke fra nett) — men vi vil snart
  // droppe dette til fordel for DOM-construction. Escape text uansett.
  const extraHtml = extraRawHtml || '';
  container.innerHTML += `<div class="chat-msg ${cls}"><div style="white-space:pre-wrap">${escapeHtml(text)}</div>${extraHtml}</div>`;
  container.scrollTop = container.scrollHeight;
  return container;
}

async function sendChat() {
  const input = document.getElementById('chatInput');
  const message = input.value.trim();
  if (!message) return;
  input.value = '';

  addChatBubble(message, 'user');

  // Typing indicator — random-generated ID, ingen user-input
  const typingId = 'typing_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  const container = document.getElementById('chatMessages');
  container.innerHTML += `<div class="chat-msg chat-msg-ai" id="${typingId}"><span class="chat-thinking">Tenker...</span></div>`;
  container.scrollTop = container.scrollHeight;

  chatHistory.push({ role: 'user', content: message });

  try {
    const data = await api('/api/llm/chat', { method: 'POST', body: { message, history: chatHistory, saveToKB: true } });
    const reply = data.response || 'Beklager, noe gikk galt.';
    chatHistory.push({ role: 'assistant', content: reply });

    const typingEl = document.getElementById(typingId);
    if (typingEl) {
      // LLM-svar kan inneholde tilfeldig tekst — alltid escape
      let html = `<div style="white-space:pre-wrap">${escapeHtml(reply)}</div>`;
      // Vis utførte tool-calls — messages og tool-navn fra backend også escape
      if (data.toolCalls && data.toolCalls.length > 0) {
        html += `<div style="margin-top:6px;font-size:0.75rem;color:var(--green)">`;
        for (const tc of data.toolCalls) {
          const toolMsg = tc.result?.message || tc.tool || '';
          html += `<div>🔧 ${escapeHtml(toolMsg)}</div>`;
        }
        html += `</div>`;
      }
      html += `<span class="kb-tag">📚 Lagret i kunnskapsbasen</span>`;
      typingEl.innerHTML = html;
    }
  } catch (err) {
    const typingEl = document.getElementById(typingId);
    if (typingEl) {
      typingEl.innerHTML = `<div style="color:var(--red)">Feil: ${escapeHtml(err.message || String(err))}. Er LLM startet?</div>`;
    }
  }
  container.scrollTop = container.scrollHeight;
}

