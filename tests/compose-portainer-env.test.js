'use strict';

// Portainer Environment variables only reach Node if compose maps them.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const COMPOSE = fs.readFileSync(path.join(__dirname, '..', 'docker-compose.yml'), 'utf8');

const MUST_PASS_THROUGH = [
  'KASSAL_API_KEY',
  'RESEND_API_KEY',
  'RESEND_FROM',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'XAI_API_KEY',
  'MARKETING_HOSTS',
  'MARKETING_CANONICAL',
];

for (const name of MUST_PASS_THROUGH) {
  test(`docker-compose maps ${name} from Portainer into the container`, () => {
    const re = new RegExp(`${name}:\\s*\\$\\{${name}:-`);
    assert.match(COMPOSE, re);
  });
}

test('compose does not hardcode integration secrets', () => {
  assert.doesNotMatch(COMPOSE, /KASSAL_API_KEY:\s*['\"]?[a-zA-Z0-9_\-.]{10,}/);
});
