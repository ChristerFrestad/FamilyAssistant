// Ollama backend client (local inference). The Ollama HTTP API exposes
// POST /api/chat with an OpenAI-adjacent shape. This wrapper keeps the
// same chat({ messages, maxTokens, systemPrompt }) signature used by the
// cloud backends so the per-family dispatcher can treat them uniformly.
//
// The base URL is caller-supplied — each family may point at their own
// Ollama instance (typically http://localhost:11434 or a Cloudflare
// Tunnel hostname shared by a friend).

const DEFAULT_MODEL = 'qwen2.5:3b';
const DEFAULT_BASE_URL = 'http://localhost:11434';

// Normalize a user-supplied base URL to a clean scheme://host[:port][/path]
// form. Operators often paste a URL copied from a browser tab, which may
// include query parameters like ?model=xxx or a trailing slash. Both would
// corrupt the '/api/chat' suffix we append. We strip query+hash, normalize
// trailing slashes, and preserve any path segment (for reverse-proxy setups
// that mount Ollama under /ollama/).
function normalizeBaseUrl(raw) {
  const input = String(raw || DEFAULT_BASE_URL).trim();
  let u;
  try {
    u = new URL(input);
  } catch {
    throw new Error(`Invalid LLM base URL: ${input}`);
  }
  const basePath = u.pathname.replace(/\/+$/, '');
  return `${u.protocol}//${u.host}${basePath}`;
}

function createOllamaClient({ baseUrl = DEFAULT_BASE_URL, model = DEFAULT_MODEL } = {}) {
  const base = normalizeBaseUrl(baseUrl);
  const endpoint = `${base}/api/chat`;

  async function chat({ messages, maxTokens = 1024, systemPrompt, signal }) {
    const turns = [];
    if (systemPrompt) turns.push({ role: 'system', content: String(systemPrompt) });
    for (const m of messages || []) {
      if (['system', 'user', 'assistant'].includes(m.role)) {
        turns.push({ role: m.role, content: String(m.content) });
      }
    }
    const res = await fetch(endpoint, {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: turns,
        stream: false,
        options: { num_predict: maxTokens },
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Ollama API failed (${res.status}): ${text}`);
    }
    const json = await res.json();
    return {
      text: json.message?.content || '',
      model: json.model || model,
      tokensIn: json.prompt_eval_count ?? null,
      tokensOut: json.eval_count ?? null,
      raw: json,
    };
  }

  async function testConnection() {
    // Hitting /api/tags is cheap and only works if Ollama is up.
    const res = await fetch(`${base}/api/tags`);
    if (!res.ok) throw new Error(`Ollama unreachable at ${base} (${res.status})`);
    const json = await res.json();
    return { ok: true, models: (json.models || []).map((m) => m.name) };
  }

  return { chat, testConnection, backend: 'ollama', model, baseUrl: base };
}

module.exports = { createOllamaClient, normalizeBaseUrl, DEFAULT_MODEL, DEFAULT_BASE_URL };
