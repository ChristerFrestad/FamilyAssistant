// Stack-wide LLM defaults from process.env. Used when a family has no
// family_llm_config row (or a cloud backend with no stored key).

'use strict';

function getInstanceLlmFallback() {
  const prefer = String(process.env.LLM_BACKEND || '').toLowerCase();
  const anthropic = process.env.ANTHROPIC_API_KEY
    ? { backend: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY }
    : null;
  const openai = process.env.OPENAI_API_KEY
    ? { backend: 'openai', apiKey: process.env.OPENAI_API_KEY }
    : null;
  const xai = process.env.XAI_API_KEY ? { backend: 'xai', apiKey: process.env.XAI_API_KEY } : null;
  const ollama =
    prefer === 'ollama' || process.env.OLLAMA_HOST
      ? { backend: 'ollama', baseUrl: process.env.OLLAMA_HOST || undefined }
      : null;

  const byName = { anthropic, openai, xai, ollama };
  if (prefer && byName[prefer]) return byName[prefer];
  return anthropic || openai || xai || ollama;
}

function getInstanceLlmPublic() {
  const fb = getInstanceLlmFallback();
  if (!fb) return { enabled: false, scope: 'instance' };
  return {
    enabled: true,
    backend: fb.backend,
    hasKey: Boolean(fb.apiKey) || fb.backend === 'ollama' || fb.backend === 'llamacpp',
    scope: 'instance',
  };
}

function getInstanceIntegrationsPublic() {
  return {
    kassal: { enabled: Boolean(process.env.KASSAL_API_KEY), scope: 'instance' },
    llm: getInstanceLlmPublic(),
    resend: { enabled: Boolean(process.env.RESEND_API_KEY), scope: 'instance' },
  };
}

module.exports = {
  getInstanceLlmFallback,
  getInstanceLlmPublic,
  getInstanceIntegrationsPublic,
};
