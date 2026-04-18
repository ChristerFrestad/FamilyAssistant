// Anthropic (Claude) backend client.
//
// Exposes chat({ model, messages, maxTokens, systemPrompt }) and
// testConnection() so the per-family dispatcher and the HTTP /test
// endpoint can share the same low-level transport.
//
// Messages use the OpenAI-style { role, content } shape. The wrapper
// converts the first 'system' message into Anthropic's top-level
// `system` field and forwards the rest as user/assistant turns.

const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
const ANTHROPIC_VERSION = '2023-06-01';

function createAnthropicClient({ apiKey, model = DEFAULT_MODEL }) {
  if (!apiKey) throw new Error('Anthropic client requires apiKey.');

  async function chat({ messages, maxTokens = 1024, systemPrompt, signal }) {
    const payload = buildPayload({
      model,
      messages,
      maxTokens,
      systemPrompt,
    });
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Anthropic API failed (${res.status}): ${text}`);
    }
    const json = await res.json();
    return {
      text: extractText(json),
      model: json.model || model,
      tokensIn: json.usage?.input_tokens ?? null,
      tokensOut: json.usage?.output_tokens ?? null,
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

  return { chat, testConnection, backend: 'anthropic', model };
}

function buildPayload({ model, messages, maxTokens, systemPrompt }) {
  const systemParts = [];
  if (systemPrompt) systemParts.push(String(systemPrompt));
  const turns = [];
  for (const m of messages || []) {
    if (m.role === 'system') {
      systemParts.push(String(m.content));
    } else if (m.role === 'user' || m.role === 'assistant') {
      turns.push({ role: m.role, content: String(m.content) });
    }
  }
  const payload = { model, max_tokens: maxTokens, messages: turns };
  if (systemParts.length > 0) payload.system = systemParts.join('\n\n');
  return payload;
}

function extractText(json) {
  if (!json || !Array.isArray(json.content)) return '';
  return json.content
    .filter((c) => c && c.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text)
    .join('');
}

module.exports = { createAnthropicClient, DEFAULT_MODEL };
