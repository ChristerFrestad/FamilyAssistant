'use strict';

// Phase 19 — CI → Railway auto-deploy workflow.
//
// Static analysis: parse .github/workflows/deploy.yml as text (no YAML
// parser dep) and assert the trigger shape, guards, and safety rails we
// care about. Also verifies DEPLOY.md documents RAILWAY_TOKEN + points
// at the workflow file.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const DEPLOY_YML = fs.readFileSync(path.join(REPO, '.github', 'workflows', 'deploy.yml'), 'utf8');
const CI_YML = fs.readFileSync(path.join(REPO, '.github', 'workflows', 'ci.yml'), 'utf8');
const DEPLOY_MD = fs.readFileSync(path.join(REPO, 'DEPLOY.md'), 'utf8');

describe('Phase 19 · deploy.yml trigger shape', () => {
  test('triggers on workflow_run of the CI workflow', () => {
    assert.match(DEPLOY_YML, /workflow_run:/);
    assert.match(DEPLOY_YML, /workflows:\s*\['CI'\]/);
    assert.match(DEPLOY_YML, /branches:\s*\n\s*-\s*main/);
  });

  test('supports manual workflow_dispatch', () => {
    assert.match(DEPLOY_YML, /workflow_dispatch:/);
  });

  test('CI workflow name is literally "CI" (matches deploy.yml)', () => {
    // deploy.yml references workflows: ['CI'] — this will silently never
    // fire if ci.yml renames its top-level `name:`. Guard the invariant.
    assert.match(CI_YML, /^name:\s*CI\s*$/m);
  });
});

describe('Phase 19 · deploy.yml guards', () => {
  test('only proceeds when CI conclusion is success', () => {
    assert.match(DEPLOY_YML, /conclusion\s*==\s*'success'/);
  });

  test('only proceeds when the trigger event was a push (ignore PR runs)', () => {
    assert.match(DEPLOY_YML, /workflow_run\.event\s*==\s*'push'/);
  });

  test('fails fast if RAILWAY_TOKEN secret is missing', () => {
    assert.match(DEPLOY_YML, /RAILWAY_TOKEN secret is not configured/);
    assert.match(DEPLOY_YML, /exit 1/);
  });

  test('cancels in-flight deploys via concurrency group', () => {
    assert.match(DEPLOY_YML, /concurrency:/);
    assert.match(DEPLOY_YML, /cancel-in-progress:\s*true/);
  });
});

describe('Phase 19 · deploy.yml permissions', () => {
  test('grants minimal permissions: contents read + deployments write', () => {
    assert.match(DEPLOY_YML, /contents:\s*read/);
    assert.match(DEPLOY_YML, /deployments:\s*write/);
  });

  test('does not grant pull-requests:write or id-token:write implicitly', () => {
    assert.doesNotMatch(DEPLOY_YML, /pull-requests:\s*write/);
    assert.doesNotMatch(DEPLOY_YML, /id-token:\s*write/);
  });
});

describe('Phase 19 · deploy step + verification', () => {
  test('installs the Railway CLI and runs railway up', () => {
    assert.match(DEPLOY_YML, /@railway\/cli/);
    assert.match(DEPLOY_YML, /railway up/);
    assert.match(DEPLOY_YML, /--ci/);
  });

  test('verifies /health after deploy when APP_URL variable is set', () => {
    assert.match(DEPLOY_YML, /\/health/);
    assert.match(DEPLOY_YML, /APP_URL/);
  });

  test('checkout uses the SHA that CI verified', () => {
    assert.match(DEPLOY_YML, /ref:\s*\$\{\{\s*needs\.guard\.outputs\.sha\s*\}\}/);
  });
});

describe('Phase 19 · DEPLOY.md documentation', () => {
  test('documents RAILWAY_TOKEN secret setup', () => {
    assert.match(DEPLOY_YML, /secrets\.RAILWAY_TOKEN/);
    assert.match(DEPLOY_MD, /RAILWAY_TOKEN/);
  });

  test('mentions the Deploy to Railway workflow and workflow_dispatch', () => {
    assert.match(DEPLOY_MD, /Deploy to Railway/);
    assert.match(DEPLOY_MD, /Run workflow/i);
  });

  test('mentions the APP_URL repo variable used by the health probe', () => {
    assert.match(DEPLOY_MD, /APP_URL/);
  });
});

describe('Phase 19 · no regression in existing CI workflow', () => {
  test('CI still runs lint + test on push to main', () => {
    assert.match(CI_YML, /branches:\s*\[main\]/);
    assert.match(CI_YML, /npm run lint/);
    assert.match(CI_YML, /npm test/);
  });
});
