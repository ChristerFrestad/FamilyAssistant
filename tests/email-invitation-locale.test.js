'use strict';

// Sprint 9 PR #119: invitation-email locale rendering.
//
// Verifies that the four template files produce the right subject + body
// for each (locale, has-message) combination, that HTML escaping kicks in
// for attacker-controllable inputs, and that the optional invitation
// message is wrapped correctly per format.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const emailService = require('../server/services/email.service');

describe('Email invitation · template rendering', () => {
  test('NO template substitutes the four primary variables', () => {
    const r = emailService.__renderInvitationTemplate({
      locale: 'no',
      inviterName: 'Christer',
      familyName: 'Frestad',
      appName: 'Hverdagsplanleggeren',
      url: 'https://example.com/v2/invite/abc',
      invitationMessage: null,
      expiresInDays: 7,
    });
    assert.match(r.subject, /Christer inviterer deg til Frestad/);
    assert.match(r.subject, /Hverdagsplanleggeren/);
    assert.match(r.html, /Bli med i Frestad/);
    assert.match(r.text, /Christer inviterer deg til Frestad/);
    assert.match(r.text, /Lenken er gyldig i 7 dager/);
  });

  test('EN template uses English copy', () => {
    const r = emailService.__renderInvitationTemplate({
      locale: 'en',
      inviterName: 'Christer',
      familyName: 'Frestad',
      appName: 'FamilyAssistant',
      url: 'https://example.com/v2/invite/abc',
      invitationMessage: null,
      expiresInDays: 7,
    });
    assert.match(r.subject, /invites you to/);
    assert.match(r.html, /Join Frestad/);
    assert.match(r.text, /valid for 7 days/);
  });

  test('invitationMessage is wrapped in a blockquote in HTML', () => {
    const r = emailService.__renderInvitationTemplate({
      locale: 'no',
      inviterName: 'Christer',
      familyName: 'Frestad',
      appName: 'Hverdagsplanleggeren',
      url: 'https://example.com/v2/invite/abc',
      invitationMessage: 'Velkommen kjære!',
      expiresInDays: 7,
    });
    assert.match(r.html, /<blockquote/);
    assert.match(r.html, /Velkommen kjære!/);
    assert.match(r.text, /^> Velkommen kjære!/m);
  });

  test('invitationMessage HTML-escapes attacker-controlled input', () => {
    const r = emailService.__renderInvitationTemplate({
      locale: 'no',
      inviterName: '<script>evil()</script>',
      familyName: 'Frestad & Co',
      appName: 'App',
      url: 'https://example.com/v2/invite/abc',
      invitationMessage: '<img src=x onerror=alert(1)>',
      expiresInDays: 7,
    });
    assert.doesNotMatch(r.html, /<script>evil/);
    assert.match(r.html, /&lt;script&gt;evil/);
    assert.match(r.html, /Frestad &amp; Co/);
    assert.doesNotMatch(r.html, /<img src=x onerror/);
    assert.match(r.html, /&lt;img src=x onerror/);
  });

  test('plain-text body keeps inviter and family names raw (no escaping)', () => {
    const r = emailService.__renderInvitationTemplate({
      locale: 'no',
      inviterName: 'Frestad & Søn',
      familyName: 'Frestad & Co',
      appName: 'App',
      url: 'https://example.com/v2/invite/abc',
      invitationMessage: null,
      expiresInDays: 7,
    });
    assert.match(r.text, /Frestad & Søn/);
    assert.match(r.text, /Frestad & Co/);
  });

  test('empty invitationMessage produces no blockquote', () => {
    const r = emailService.__renderInvitationTemplate({
      locale: 'no',
      inviterName: 'Christer',
      familyName: 'Frestad',
      appName: 'App',
      url: 'https://example.com/v2/invite/abc',
      invitationMessage: '   ',
      expiresInDays: 7,
    });
    assert.doesNotMatch(r.html, /<blockquote/);
    assert.doesNotMatch(r.text, /^> /m);
  });

  test('unsupported locale falls back to NO', () => {
    const r = emailService.__renderInvitationTemplate({
      locale: 'fr',
      inviterName: 'X',
      familyName: 'Y',
      appName: 'App',
      url: 'https://example.com',
      invitationMessage: null,
      expiresInDays: 7,
    });
    assert.match(r.subject, /inviterer/);
  });

  test('SUPPORTED_INVITATION_LOCALES exposes the two pilot locales', () => {
    assert.deepStrictEqual([...emailService.SUPPORTED_INVITATION_LOCALES], ['no', 'en']);
  });

  test('newlines in invitationMessage are converted to <br /> in HTML', () => {
    const r = emailService.__renderInvitationTemplate({
      locale: 'no',
      inviterName: 'Christer',
      familyName: 'Frestad',
      appName: 'App',
      url: 'https://example.com',
      invitationMessage: 'Line 1\nLine 2',
      expiresInDays: 7,
    });
    assert.match(r.html, /Line 1<br \/>Line 2/);
    assert.match(r.text, /^> Line 1\n> Line 2/m);
  });
});
