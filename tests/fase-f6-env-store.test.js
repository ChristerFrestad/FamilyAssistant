// Fase F6 — .env-skriving sikkerhet + endpoint-roundtrip
//
// Tester:
//   1. Whitelist — kun godkjente nøkler
//   2. Format-validator — per-key regex
//   3. Sanitize — avviser shell/control-chars
//   4. Mask — plain-text lekkes aldri
//   5. Write + read roundtrip mot tempfil
//   6. Concurrency — samtidige skriv
//   7. Endpoints via HTTP

const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Vi må mocke ENV_PATH før require for å unngå å skrive til ekte .env.
// Workaround: lag en temp-dir og sett process.cwd via chdir.
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-f6-test-'));
const origCwd = process.cwd();
process.chdir(tempDir);

// Clear require cache så modulen leser ny cwd
delete require.cache[require.resolve('../server/services/env-store.service')];
const envStore = require('../server/services/env-store.service');

describe('Fase F6 — env-store sanitize', () => {
  test('avviser newline', () => {
    assert.throws(() => envStore.sanitize('foo\nbar'), /ugyldige tegn/);
  });

  test('avviser carriage return', () => {
    assert.throws(() => envStore.sanitize('foo\rbar'), /ugyldige tegn/);
  });

  test('avviser null byte', () => {
    assert.throws(() => envStore.sanitize('foo\0bar'), /ugyldige tegn/);
  });

  test('avviser control chars', () => {
    assert.throws(() => envStore.sanitize('foo\x1bbar'), /ugyldige tegn/);
  });

  test('avviser dobbelt-quote', () => {
    assert.throws(() => envStore.sanitize('foo"bar'), /anførselstegn/);
  });

  test('avviser tom streng', () => {
    assert.throws(() => envStore.sanitize(''), /tom/);
  });

  test('avviser for lang verdi', () => {
    assert.throws(() => envStore.sanitize('a'.repeat(501)), /for lang/);
  });

  test('aksepterer normal verdi', () => {
    assert.equal(envStore.sanitize('sk-1234567890abcdef'), 'sk-1234567890abcdef');
  });
});

describe('Fase F6 — env-store whitelist', () => {
  test('avviser ukjent nøkkel', async () => {
    await assert.rejects(envStore.write('SECRET_THING', 'hax'), /Ukjent nøkkel/);
  });

  test('avviser ugyldig format for OPENAI_API_KEY', async () => {
    await assert.rejects(envStore.write('OPENAI_API_KEY', 'notanopenaikey'), /Ugyldig format/);
  });

  test('avviser ugyldig format for LLM_BACKEND', async () => {
    await assert.rejects(envStore.write('LLM_BACKEND', 'gemini'), /Ugyldig format/);
  });

  test('aksepterer gyldig LLM_BACKEND', async () => {
    const r = await envStore.write('LLM_BACKEND', 'openai');
    assert.equal(r.ok, true);
    assert.equal(r.requiresRestart, false);
  });

  test('aksepterer gyldig OPENAI_API_KEY', async () => {
    const r = await envStore.write('OPENAI_API_KEY', 'sk-test1234567890abcdefghij');
    assert.equal(r.ok, true);
    assert.ok(r.masked.endsWith('ghij'));
    assert.ok(!r.masked.includes('sk-test'));
  });

  test('OLLAMA_URL krever restart', async () => {
    const r = await envStore.write('OLLAMA_URL', 'http://localhost:11434');
    assert.equal(r.ok, true);
    assert.equal(r.requiresRestart, true);
  });
});

describe('Fase F6 — mask', () => {
  test('maskerer lange verdier med siste 4 synlig', () => {
    const masked = envStore.mask('sk-1234567890abcdef');
    assert.ok(masked.endsWith('cdef'));
    assert.ok(!masked.includes('1234'));
  });

  test('maskerer korte verdier helt', () => {
    const masked = envStore.mask('short');
    assert.equal(masked, '●●●●●');
  });

  test('null input → null', () => {
    assert.equal(envStore.mask(null), null);
    assert.equal(envStore.mask(undefined), null);
    assert.equal(envStore.mask(''), null);
  });
});

describe('Fase F6 — read + write roundtrip', () => {
  test('readMasked etter flere skriv', async () => {
    await envStore.write('OPENAI_API_KEY', 'sk-testabcdef1234567890');
    await envStore.write('KASSAL_API_KEY', 'kassal123456789abc');
    const masked = envStore.readMasked();
    assert.ok(masked.OPENAI_API_KEY);
    assert.ok(masked.OPENAI_API_KEY.endsWith('7890'));
    assert.ok(masked.KASSAL_API_KEY);
    // Verifiser at klartekst IKKE dukker opp i masked
    assert.ok(!masked.OPENAI_API_KEY.includes('sk-test'));
    assert.ok(!masked.KASSAL_API_KEY.includes('kassal1'));
  });

  test('write oppdaterer eksisterende nøkkel (ikke dupliserer)', async () => {
    await envStore.write('OPENAI_API_KEY', 'sk-firstoldtestvaluexyz');
    await envStore.write('OPENAI_API_KEY', 'sk-secondnewvaluetest123');
    const content = fs.readFileSync(envStore._ENV_PATH, 'utf8');
    const matches = content.match(/OPENAI_API_KEY=/g);
    assert.equal(matches.length, 1, 'bare én rad for OPENAI_API_KEY');
    assert.ok(content.includes('sk-secondnewvaluetest123'));
  });
});

describe('Fase F6 — concurrency', () => {
  test('10 samtidige skriv mot ulike keys serialiseres OK', async () => {
    const keys = [
      { key: 'OPENAI_API_KEY', value: 'sk-concurrenttest1234567' },
      { key: 'ANTHROPIC_API_KEY', value: 'sk-ant-concurrenttest123' },
      { key: 'XAI_API_KEY', value: 'xai-concurrenttest123456' },
      { key: 'KASSAL_API_KEY', value: 'kassaltoken12345678' },
      { key: 'LLM_BACKEND', value: 'anthropic' },
    ];
    // 10 skriv, vekslende keys
    const writes = [];
    for (let i = 0; i < 10; i++) {
      const k = keys[i % keys.length];
      writes.push(envStore.write(k.key, k.value));
    }
    const results = await Promise.all(writes);
    for (const r of results) {
      assert.equal(r.ok, true);
    }
    // Verifiser at alle keys finnes i fila
    const masked = envStore.readMasked();
    assert.ok(masked.OPENAI_API_KEY);
    assert.ok(masked.ANTHROPIC_API_KEY);
    assert.ok(masked.XAI_API_KEY);
  });
});

describe('Fase F6 — backup', () => {
  test('backup opprettes etter skriving', async () => {
    await envStore.write('OPENAI_API_KEY', 'sk-backuptestvalue123456');
    // Second write skal trigge backup
    await envStore.write('OPENAI_API_KEY', 'sk-backuptestsecond12345');
    assert.ok(fs.existsSync(envStore._BACKUP_PATH), 'backup-fil finnes');
  });
});

// Restore cwd etter alle tester
process.on('exit', () => {
  try {
    process.chdir(origCwd);
  } catch {}
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {}
});
