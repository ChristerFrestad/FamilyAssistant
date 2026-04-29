-- Migration 021: track onboarding completion per user
--
-- After magic-link verify the server needs to know whether the user
-- has finished onboarding (family setup + profile) so it can redirect
-- to /v2/dashboard or /v2/onboarding/family. Until now the absence of
-- a family_id was used as a proxy, but that mixes "no family yet" with
-- "in a family but profile not finished". A dedicated flag is clearer
-- and survives the cases where a user joins an existing family via
-- invitation without going through the full setup flow.
--
-- Default 0 (FALSE) so all existing users are forced through the
-- onboarding flow on next login. Christer is the only existing
-- account on the pilot and will retake the (very short) onboarding
-- once — acceptable cost for a clean slate.

ALTER TABLE users ADD COLUMN onboarding_completed INTEGER NOT NULL DEFAULT 0;
