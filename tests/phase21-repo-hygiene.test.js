'use strict';

// Phase 21 — repo hygiene for public GitHub.
//
// Verifies the on-disk doc set is the minimal one we committed to ship:
//   - README.md + LICENSE exist (mandatory for OSS repos)
//   - Stale/misleading docs are gone (they contradicted phase 1–20)
//   - SECURITY.md covers the multi-tenant guarantees
//   - Remaining docs list matches exactly what we intend to keep

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');

function exists(rel) {
  return fs.existsSync(path.join(REPO, rel));
}

describe('Phase 21 · Required root-level docs', () => {
  test('README.md exists and is non-empty', () => {
    assert.ok(exists('README.md'));
    const body = fs.readFileSync(path.join(REPO, 'README.md'), 'utf8');
    assert.ok(body.length > 500, 'README.md is suspiciously short');
    // Must cover the essentials:
    assert.match(body, /FamilyAssistant/);
    assert.match(body, /DEPLOY\.md/);
    assert.match(body, /AUTH_TOKEN/);
    assert.match(body, /NODE_ENV=production/);
    assert.match(body, /LICENSE/);
  });

  test('LICENSE exists and is MIT', () => {
    assert.ok(exists('LICENSE'));
    const body = fs.readFileSync(path.join(REPO, 'LICENSE'), 'utf8');
    assert.match(body, /MIT License/);
    assert.match(body, /Christer Frestad/);
    assert.match(body, /AS IS/);
  });

  test('package.json license field matches LICENSE file', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
    assert.equal(pkg.license, 'MIT');
  });
});

describe('Phase 21 · Stale docs removed', () => {
  const removed = [
    'BRUKERGUIDE.md',
    'docs/RELEASE_V1_3_0.md',
    'docs/TEST_COVERAGE_ANALYSIS.md',
    'docs/TYPE_COVERAGE.md',
    'docs/SAFETY_CASE.md',
    'docs/RISK_REGISTER.md',
  ];
  for (const f of removed) {
    test(`${f} is gone`, () => {
      assert.ok(!exists(f), `${f} still exists — should have been deleted in phase 21`);
    });
  }
});

describe('Phase 21 · Kept docs are exactly the intended set', () => {
  test('root-level docs match expected whitelist', () => {
    const rootMds = fs
      .readdirSync(REPO)
      .filter((f) => f.endsWith('.md'))
      .sort();
    // Whitelist extended for the CLAUDE.md workflow (see CLAUDE.md section
    // 6.5 — policy-tests vs code-tests). AGENT_LOG, CLAUDE, CONTEXT, and
    // REFERENCES are intentional root-level governance docs; they live in
    // root per CLAUDE.md DEL 0 and REFERENCES.md "Toppnivå-dokumentasjon".
    assert.deepEqual(rootMds, [
      'AGENT_LOG.md',
      'CHANGELOG.md',
      'CI.md',
      'CLAUDE.md',
      'CONTEXT.md',
      'CONTRIBUTING.md',
      'DEPLOY.md',
      'README.md',
      'REFERENCES.md',
      'RUNBOOK.md',
      'SECURITY.md',
    ]);
  });

  test('docs/ folder contains only the governance .md set', () => {
    // Only direct .md children count against the whitelist. Subfolders like
    // docs/analyses/ and docs/monitoring/ are managed by the CLAUDE.md
    // workflow and are deliberately not enumerated here (see CLAUDE.md
    // section 6.5).
    const docs = fs
      .readdirSync(path.join(REPO, 'docs'), { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map((entry) => entry.name)
      .sort();
    // Sprint 10 (PR #122) added BRAND_SYSTEM.md as the brand-config
    // governance document. Lives in docs/ root rather than a subfolder
    // because it pairs conceptually with DOMAIN_MODEL — both are
    // cross-cutting governance specs that the CLAUDE.md workflow
    // refers to from multiple sprints.
    assert.deepEqual(docs, ['BRAND_SYSTEM.md', 'DB_INDEXES.md', 'DOMAIN_MODEL.md']);
  });
});

describe('Phase 21 · SECURITY.md covers multi-tenant guarantees', () => {
  const SEC = fs.readFileSync(path.join(REPO, 'SECURITY.md'), 'utf8');

  test('mentions tenant isolation via AsyncLocalStorage', () => {
    // Updated 2026-05-27: SECURITY.md translated to English in PR 4
    // (`docs/analyses/2026-05-27-public-repo-readiness.md` §13 beslutning 2).
    // Norwegian "isolasjon" -> English "isolation". Policy intent unchanged:
    // SECURITY.md must still document tenant-isolation via AsyncLocalStorage.
    assert.match(SEC, /tenant.?isolation/i);
    assert.match(SEC, /AsyncLocalStorage/);
  });

  test('mentions AES-256-GCM encryption of stored LLM keys', () => {
    assert.match(SEC, /AES-256-GCM/);
    assert.match(SEC, /ENCRYPTION_KEY/);
  });

  test('mentions hashed family-id in observability', () => {
    assert.match(SEC, /SHA-256/);
    assert.match(SEC, /family.?id/i);
  });

  test('mentions role enforcement for owner/adult/child', () => {
    assert.match(SEC, /owner/);
    assert.match(SEC, /adult/);
    assert.match(SEC, /child/);
  });

  test('mentions session-cookie hygiene (HttpOnly + SameSite)', () => {
    assert.match(SEC, /HttpOnly/);
    assert.match(SEC, /SameSite/);
  });
});
