-- Migration 028: invited_email column on family_invitations
--
-- Sprint 7 PR C4. The existing invitation flow (migration 014) was
-- token-based with an optional pre-assignment to a profile_member_id;
-- the inviter shared the URL out-of-band. To enable Resend email-
-- delivery the invitation row needs to know which email to send to.
--
-- The column is nullable so existing rows from the legacy flow remain
-- valid; new invitations created via the email path populate it.

ALTER TABLE family_invitations ADD COLUMN invited_email TEXT;

CREATE INDEX IF NOT EXISTS idx_invitations_email ON family_invitations(invited_email);
