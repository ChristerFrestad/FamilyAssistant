// Per-family LLM dispatcher.
//
// Resolves the correct backend client for the current family by reading
// family_llm_config, decrypting the stored API key if any, and returning
// a client exposing a uniform { chat, testConnection, backend, model }
// surface.
//
// Callers hit NotConfiguredError when the family has no config row or
// a cloud backend with no key — the HTTP layer turns that into a
// 412 Precondition Required with a body the frontend uses to point the
// user at /settings → AI-motor.

const { decrypt } = require('../auth/crypto');
const { createAnthropicClient } = require('./anthropic');
const { createOpenAIClient } = require('./openai');
const { createXaiClient } = require('./xai');
const { createOllamaClient } = require('./ollama');
const { getInstanceLlmFallback } = require('./instance-fallback');

class NotConfiguredError extends Error {
  constructor(message, { backend = null } = {}) {
    super(message);
    this.name = 'NotConfiguredError';
    this.code = 'llm_not_configured';
    this.backend = backend;
  }
}

function buildClientFromRow(row) {
  if (!row) {
    throw new NotConfiguredError('No LLM backend configured for this family.');
  }
  const { backend, model, base_url, api_key_encrypted } = row;
  switch (backend) {
    case 'anthropic': {
      if (!api_key_encrypted) {
        throw new NotConfiguredError('Anthropic API key not set for this family.', { backend });
      }
      return createAnthropicClient({
        apiKey: decrypt(api_key_encrypted),
        model: model || undefined,
      });
    }
    case 'openai': {
      if (!api_key_encrypted) {
        throw new NotConfiguredError('OpenAI API key not set for this family.', { backend });
      }
      return createOpenAIClient({ apiKey: decrypt(api_key_encrypted), model: model || undefined });
    }
    case 'xai': {
      if (!api_key_encrypted) {
        throw new NotConfiguredError('xAI API key not set for this family.', { backend });
      }
      return createXaiClient({ apiKey: decrypt(api_key_encrypted), model: model || undefined });
    }
    case 'ollama':
    case 'llamacpp': {
      // Local backends do not require an API key. base_url may be blank
      // to fall back to the Ollama default (localhost:11434).
      return createOllamaClient({
        baseUrl: base_url || undefined,
        model: model || undefined,
      });
    }
    default:
      throw new NotConfiguredError(`Unsupported backend: ${backend}`, { backend });
  }
}

function familyRowIsUsable(row) {
  if (!row) return false;
  if (row.backend === 'ollama' || row.backend === 'llamacpp') return true;
  return Boolean(row.api_key_encrypted);
}

function getClientForFamily(repos, familyId) {
  if (!repos?.llmConfig) {
    throw new NotConfiguredError('LLM config repo not available.');
  }
  const row = repos.llmConfig.getForFamily(familyId);
  if (familyRowIsUsable(row)) return buildClientFromRow(row);
  const fallback = getInstanceLlmFallback();
  if (fallback) return getClientFromCandidate(fallback);
  return buildClientFromRow(row);
}

function getClientFromCandidate({ backend, model, baseUrl, apiKey }) {
  // Helper for the POST /test endpoint: build a client from caller-supplied
  // values without persisting anything. The api key (if provided) is used
  // in-memory only and never written.
  switch (backend) {
    case 'anthropic':
      if (!apiKey) throw new NotConfiguredError('Anthropic requires apiKey.', { backend });
      return createAnthropicClient({ apiKey, model });
    case 'openai':
      if (!apiKey) throw new NotConfiguredError('OpenAI requires apiKey.', { backend });
      return createOpenAIClient({ apiKey, model });
    case 'xai':
      if (!apiKey) throw new NotConfiguredError('xAI requires apiKey.', { backend });
      return createXaiClient({ apiKey, model });
    case 'ollama':
    case 'llamacpp':
      return createOllamaClient({ baseUrl, model });
    default:
      throw new NotConfiguredError(`Unsupported backend: ${backend}`, { backend });
  }
}

module.exports = {
  NotConfiguredError,
  getClientForFamily,
  getClientFromCandidate,
  buildClientFromRow,
};
