// OpenAI backend client (Chat Completions API).

const ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_MODEL = 'gpt-4o-mini';

function createOpenAIClient({ apiKey, model = DEFAULT_MODEL }) {
  if (!apiKey) throw new Error('OpenAI client requires apiKey.');

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
      throw new Error(`OpenAI API failed (${res.status}): ${text}`);
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

  return { chat, testConnection, backend: 'openai', model };
}

module.exports = { createOpenAIClient, DEFAULT_MODEL };
