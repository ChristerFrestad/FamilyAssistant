// xAI (Grok) backend client. The xAI API is OpenAI-compatible, so we
// just point the chat completions handler at a different endpoint and
// let the rest of the protocol stay identical.

const ENDPOINT = 'https://api.x.ai/v1/chat/completions';
const DEFAULT_MODEL = 'grok-3-mini';

function createXaiClient({ apiKey, model = DEFAULT_MODEL }) {
  if (!apiKey) throw new Error('xAI client requires apiKey.');

  async function chat({ messages, maxTokens = 1024, systemPrompt, signal }) {
    const turns = [];
    if (systemPrompt) turns.push({ role: 'system', content: String(systemPrompt) });
    for (const m of messages || []) {
      if (['system', 'user', 'assistant'].includes(m.role)) {
        turns.push({ role: m.role, content: String(m.content) });
      }
    }
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, messages: turns, max_tokens: maxTokens }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`xAI API failed (${res.status}): ${text}`);
    }
    const json = await res.json();
    return {
      text: json.choices?.[0]?.message?.content || '',
      model: json.model || model,
      tokensIn: json.usage?.prompt_tokens ?? null,
      tokensOut: json.usage?.completion_tokens ?? null,
      raw: json,
    };
  }

  async function testConnection() {
    const { text } = await chat({
      messages: [{ role: 'user', content: 'Reply with OK.' }],
      maxTokens: 10,
    });
    return { ok: true, sample: text.slice(0, 40) };
  }

  return { chat, testConnection, backend: 'xai', model };
}

module.exports = { createXaiClient, DEFAULT_MODEL };
