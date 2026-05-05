-- Migration 029: invitation_message + locale on family_invitations
--
-- Sprint 9 PR #119. The Sprint 7 invitation flow (migrations 014, 028)
-- supports email-delivered invitations but not a personal greeting from
-- the inviter, and emails were rendered in a single hard-coded language.
--
-- Two additions:
--   * invitation_message TEXT (nullable, max 500 chars enforced at the
--     repo/route layer) — optional personal note shown in the email
--     and on the accept page so the recipient sees who invited them
--     and why.
--   * locale TEXT NOT NULL DEFAULT 'no' — language used to render the
--     invitation email. Stored on the row so resend reuses the same
--     language. Constrained to the languages the i18n bundle supports
--     ('no','en') so a typo at the API layer fails fast.
--
-- Both columns are additive. Existing pending invitations from earlier
-- migrations get NULL message and 'no' locale (the pilot default), so
-- backwards compatibility is preserved.

ALTER TABLE family_invitations
  ADD COLUMN invitation_message TEXT;

ALTER TABLE family_invitations
  ADD COLUMN locale TEXT NOT NULL DEFAULT 'no'
    CHECK (locale IN ('no','en'));
