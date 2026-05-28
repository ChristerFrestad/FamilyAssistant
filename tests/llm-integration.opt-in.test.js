'use strict';

// Opt-in LLM integration suite.
//
// SKIPPED by default. Only runs when the operator explicitly opts
// in by setting LLM_INTEGRATION_TESTS=1 in the environment. CI does
// not set this flag, so the regular test gates do not need network
// access or API credentials to stay green.
//
// Two reasons this is opt-in:
//   1. Real LLM round-trips cost real money (per-token billing for
//      Anthropic / OpenAI / xAI) and real time (Ollama / llama.cpp
//      respond in seconds, not milliseconds).
//   2. Test flakiness from external infrastructure is exactly the
//      kind of noise that erodes trust in CI. Smoke-testing the
//      live LLMs is valuable, but only when a human chose to do it.
//
// Per backend, the suite also requires the backend's own credential
// to be present; otherwise that backend's tests are skipped
// individually. The composite gate is:
//
//   LLM_INTEGRATION_TESTS=1
//   AND (backend-specific credential set OR backend ping succeeds)
//
// Run modes:
//
//   # Run all enabled backends:
//   LLM_INTEGRATION_TESTS=1 npm run test:llm
//
//   # Only Anthropic:
//   LLM_INTEGRATION_TESTS=1 ANTHROPIC_API_KEY=sk-... npm run test:llm
//
//   # Only the local Ollama on the dev box:
//   LLM_INTEGRATION_TESTS=1 OLLAMA_HOST=http://localhost:11434 npm run test:llm
//
// What it asserts:
//
//   - testConnection returns a non-empty string from the live backend.
//   - chat() with a deterministic prompt returns a non-empty text and
//     a model identifier in the response shape the per-family adapter
//     promises.
//   - For Ollama: the suite first checks /api/tags to confirm the
//     daemon is reachable, so the rest of the assertions degrade to
//     a clear "skipped — daemon offline" instead of a confusing 60-s
//     fetch timeout.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const ENABLED = process.env.LLM_INTEGRATION_TESTS === '1';

const { createAnthropicClient } = require('../server/llm/anthropic');
const { createOpenAIClient } = require('../server/llm/openai');
const { createXaiClient } = require('../server/llm/xai');
const { createOllamaClient } = require('../server/llm/ollama');

const SAMPLE_PROMPT = [
  { role: 'user', content: 'Reply with exactly the word OK and nothing else.' },
];

async function pingOllama(host) {
  try {
    const res = await fetch(`${host.replace(/\/$/, '')}/api/tags`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

describe('LLM integration · opt-in', { skip: !ENABLED }, () => {
  describe('Anthropic', { skip: !process.env.ANTHROPIC_API_KEY }, () => {
    test('testConnection returns a non-empty sample', async () => {
      const client = createAnthropicClient({ apiKey: process.env.ANTHROPIC_API_KEY });
      const result = await client.testConnection();
      assert.equal(result.ok, true);
      assert.ok(typeof result.sample === 'string' && result.sample.length > 0);
    });

    test('chat returns text + model + token counts', async () => {
      const client = createAnthropicClient({ apiKey: process.env.ANTHROPIC_API_KEY });
      const reply = await client.chat({ messages: SAMPLE_PROMPT, maxTokens: 20 });
      assert.ok(typeof reply.text === 'string' && reply.text.length > 0);
      assert.ok(typeof reply.model === 'string' && reply.model.length > 0);
      assert.ok(reply.tokensIn === null || Number.isFinite(reply.tokensIn));
      assert.ok(reply.tokensOut === null || Number.isFinite(reply.tokensOut));
    });
  });

  describe('OpenAI', { skip: !process.env.OPENAI_API_KEY }, () => {
    test('testConnection returns a non-empty sample', async () => {
      const client = createOpenAIClient({ apiKey: process.env.OPENAI_API_KEY });
      const result = await client.testConnection();
      assert.equal(result.ok, true);
      assert.ok(typeof result.sample === 'string' && result.sample.length > 0);
    });

    test('chat returns text + model', async () => {
      const client = createOpenAIClient({ apiKey: process.env.OPENAI_API_KEY });
      const reply = await client.chat({ messages: SAMPLE_PROMPT, maxTokens: 20 });
      assert.ok(typeof reply.text === 'string' && reply.text.length > 0);
      assert.ok(typeof reply.model === 'string' && reply.model.length > 0);
    });
  });

  describe('xAI', { skip: !process.env.XAI_API_KEY }, () => {
    test('testConnection returns a non-empty sample', async () => {
      const client = createXaiClient({ apiKey: process.env.XAI_API_KEY });
      const result = await client.testConnection();
      assert.equal(result.ok, true);
      assert.ok(typeof result.sample === 'string' && result.sample.length > 0);
    });

    test('chat returns text + model', async () => {
      const client = createXaiClient({ apiKey: process.env.XAI_API_KEY });
      const reply = await client.chat({ messages: SAMPLE_PROMPT, maxTokens: 20 });
      assert.ok(typeof reply.text === 'string' && reply.text.length > 0);
      assert.ok(typeof reply.model === 'string' && reply.model.length > 0);
    });
  });

  describe('Ollama (local)', () => {
    const baseUrl = process.env.OLLAMA_HOST || 'http://localhost:11434';
    test('daemon reachable and chat returns text', async (t) => {
      const reachable = await pingOllama(baseUrl);
      if (!reachable) {
        t.skip(`Ollama at ${baseUrl} not reachable — skipping`);
        return;
      }
      const client = createOllamaClient({
        baseUrl,
        model: process.env.OLLAMA_MODEL || 'llama3.2',
      });
      const reply = await client.chat({ messages: SAMPLE_PROMPT, maxTokens: 20 });
      assert.ok(typeof reply.text === 'string' && reply.text.length > 0);
      assert.ok(typeof reply.model === 'string' && reply.model.length > 0);
    });
  });
});
