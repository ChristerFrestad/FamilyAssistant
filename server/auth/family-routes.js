// Family and invitation HTTP endpoints.
//
// Registered from server/routes.js via registerFamilyRoutes(router, { repos }).
// Authentication is handled by the global authenticate() middleware; role
// checks are applied per-route. A small subset of paths are soft-auth
// (e.g. the /api/invitations/:token peek) so anonymous visitors can preview
// an invite before clicking the Google-sign-in button.

const { errors } = require('../http/errors');
const { requireRole } = require('./middleware');
const { randomToken } = require('./crypto');
const { config } = require('../config');
const emailService = require('../services/email.service');
const { runWithFamily } = require('./family-context');
const { validateBody } = require('../http/validate');
const schemas = require('../schemas');
const { buildFamilyBackup, importFamilyBackup } = require('../services/family-backup.service');

const INVITE_URL_PATH = '/invite/';
const INVITE_TTL_DAYS = 7;
const MAX_INVITATION_MESSAGE_LENGTH = 500;
const VALID_INVITATION_LOCALES = Object.freeze(['no', 'en']);
// Per-family create-rate-limit: 20 invitations / 60 minutes. The global
// IP-bucket alone (300/min) is too generous when the actor is an
// authenticated owner — a misbehaving owner could otherwise drown
// recipients in email. 20/h is well above any realistic family-onboarding
// burst (a single owner inviting all their adults at once is ~5 emails).
const CREATE_RATE_LIMIT_PER_HOUR = 20;
// Per-invitation resend cooldown: 60 seconds between resends. Prevents
// repeated-button spam from sending duplicate emails to the recipient.
// Derived from `expires_at - INVITE_TTL_DAYS` since every create + resend
// rewrites expires_at to "now + 7 days".
const RESEND_COOLDOWN_MS = 60_000;
// Common audit metadata helper. Keeps the four audit-log calls below
// consistent and lets us attach a structured `event` discriminator the
// dashboard can split on. metadata is stored as JSON (truncated 2000
// chars) — never includes the token itself, only public-ish fields the
// owner already sees.
function auditInvitation(repos, ctx, eventName, invitation, extra = {}) {
  try {
    // The audit-log row's family_id column is sourced from the
    // AsyncLocalStorage family-context. For three of the four events
    // (sent / revoked / resent) ctx.familyId already matches the
    // invitation's owning family because the route is owner-only and
    // middleware has run. The accept-flow is the odd one: the joining
    // user starts outside the family, so ctx.familyId is null at
    // request-context time; we re-enter runWithFamily(invitation.
    // family_id) here so the audit row is written under the correct
    // family scope and reachable from the owner's audit-log queries.
    const familyIdForContext = invitation?.family_id ?? ctx.familyId ?? null;
    const writeAudit = () =>
      repos.auditLog.record({
        requestId: ctx.requestId || ctx.req?.headers?.['x-request-id'] || 'unknown',
        actor: String(ctx.user?.id ?? 'unknown'),
        action: (ctx.req?.method || 'POST').toUpperCase(),
        entityType: 'family_invitation',
        entityId: invitation?.id != null ? String(invitation.id) : null,
        route: ctx.req?.url || 'unknown',
        metadata: {
          event: eventName,
          familyId: familyIdForContext,
          invitedEmail: invitation?.invited_email ?? null,
          locale: invitation?.locale ?? null,
          ...extra,
        },
      });
    if (familyIdForContext && familyIdForContext !== ctx.familyId) {
      runWithFamily(familyIdForContext, writeAudit);
    } else {
      writeAudit();
    }
  } catch (err) {
    console.warn(`[invitation] audit-log write failed: ${err.message}`);
  }
}

// Best-effort invitation-email send. Logs the URL if Resend is not
// wired (or fails) so the operator can copy it manually. Never throws —
// invitation creation must succeed even if email-delivery hiccups.
function sendInvitationEmailBestEffort({
  to,
  url,
  familyName,
  inviterName,
  invitationMessage,
  locale,
}) {
  try {
    if (!emailService.isEmailConfigured()) {
      console.log(`[invitation] Resend not configured; URL for ${to}: ${url}`);
      return;
    }
    emailService
      .sendInvitationEmail({
        to,
        url,
        familyName,
        inviterName,
        invitationMessage,
        expiresInDays: INVITE_TTL_DAYS,
        locale,
      })
      .catch((err) => {
        console.warn(`[invitation] sendInvitationEmail failed: ${err.message}`);
      });
  } catch (err) {
    console.warn(`[invitation] best-effort send failed: ${err.message}`);
  }
}

function invitationUrlFor(token) {
  const base = (config.APP_URL || '').replace(/\/+$/, '');
  const path = `${INVITE_URL_PATH}${encodeURIComponent(token)}`;
  return base ? `${base}${path}` : path;
}

function validateEmailFormat(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  return trimmed.length > 0 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

// ============================================================
// Family basics
// ============================================================

function handleGetFamily(ctx, repos) {
  if (!ctx.familyId) throw errors.forbidden('User is not currently in a family.');
  const family = repos.family.findFamilyById(ctx.familyId);
  if (!family) throw errors.notFound('Family not found.');
  const members = repos.family.listMembers(ctx.familyId);
  const users = repos.auth.listByFamily(ctx.familyId);
  return {
    family: {
      id: family.id,
      name: family.name,
      ownerUserId: family.owner_user_id,
      createdAt: family.created_at,
      updatedAt: family.updated_at,
      gamificationEnabled: family.gamification_enabled !== 0,
      weekGoal: family.week_goal ?? 5,
    },
    profileMembers: members,
    users: users.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      avatarUrl: u.avatar_url,
      role: u.role,
      profileMemberId: u.profile_member_id,
      lastSeenAt: u.last_seen_at,
    })),
    portionSum: repos.family.portionSum(ctx.familyId),
  };
}

function handlePatchGamification(ctx, repos) {
  if (!ctx.familyId) throw errors.forbidden('User is not currently in a family.');
  const updated = repos.family.updateGamification(ctx.familyId, {
    enabled: ctx.body.enabled,
    weekGoal: ctx.body.weekGoal,
  });
  if (!updated) throw errors.notFound('Family not found.');
  return {
    ok: true,
    enabled: updated.gamification_enabled !== 0,
    weekGoal: updated.week_goal ?? 5,
  };
}

function handleGetBackup(ctx, repos) {
  if (!ctx.familyId) throw errors.forbidden('User is not currently in a family.');
  return buildFamilyBackup(repos, ctx.familyId);
}

function handleImportBackup(ctx, repos) {
  if (!ctx.familyId) throw errors.forbidden('User is not currently in a family.');
  return importFamilyBackup(repos, ctx.familyId, ctx.body);
}

function handleRenameFamily(ctx, repos) {
  if (!ctx.familyId) throw errors.forbidden('User is not currently in a family.');
  const name = (ctx.body?.name || '').trim();
  if (!name) throw errors.badRequest('Family name is required.');
  if (name.length > 100) throw errors.badRequest('Family name is too long (max 100 chars).');
  const updated = repos.family.renameFamily(ctx.familyId, name);
  return { ok: true, family: updated };
}

// ============================================================
// Profile members (name-only roster)
// ============================================================

function handleAddMember(ctx, repos) {
  if (!ctx.familyId) throw errors.forbidden('User is not currently in a family.');
  const { name, category, portionFactor } = ctx.body || {};
  if (!name) throw errors.badRequest('Member name is required.');
  try {
    const member = repos.family.addMember(ctx.familyId, {
      name,
      category: category || 'adult',
      portionFactor: portionFactor ?? 1.0,
    });
    return { ok: true, member };
  } catch (err) {
    throw errors.badRequest(err.message);
  }
}

function handleUpdateMember(ctx, repos) {
  if (!ctx.familyId) throw errors.forbidden('User is not currently in a family.');
  const memberId = parseInt(ctx.params.id, 10);
  if (!Number.isInteger(memberId) || memberId <= 0) {
    throw errors.badRequest('Invalid member id.');
  }
  const { name, category, portionFactor, sortOrder } = ctx.body || {};
  try {
    const updated = repos.family.updateMember(ctx.familyId, memberId, {
      name,
      category,
      portionFactor,
      sortOrder,
    });
    if (!updated) throw errors.notFound('Member not found.');
    return { ok: true, member: updated };
  } catch (err) {
    if (err.status) throw err;
    throw errors.badRequest(err.message);
  }
}

function handleDeleteMember(ctx, repos) {
  if (!ctx.familyId) throw errors.forbidden('User is not currently in a family.');
  const memberId = parseInt(ctx.params.id, 10);
  if (!Number.isInteger(memberId) || memberId <= 0) {
    throw errors.badRequest('Invalid member id.');
  }
  repos.family.deleteMember(ctx.familyId, memberId);
  return { ok: true };
}

// ============================================================
// B7 — Per-member diet (allergies / dislikes / diet_tags / custom note)
// ============================================================
//
// GET  /api/family/members/:id/diet  → { memberId, name, allergies,
//                                        dislikes, dietTags, customDietNote }
//     allergies/dislikes are either a string array OR null (null =
//     inherit from family_profile.allergies/dislikes).
//
// PUT  /api/family/members/:id/diet  → same shape as GET after update.
//     Body fields follow partial-update semantics:
//       undefined  → keep existing value
//       null       → clear (NULL for allergies/dislikes, '[]' for dietTags,
//                    null for customDietNote)
//       array/str  → replace
//     diet_tags values are validated against family.repo.VALID_DIET_TAGS
//     (14 D3 enum values); unknown values throw 400.

function handleGetMemberDiet(ctx, repos) {
  if (!ctx.familyId) throw errors.forbidden('User is not currently in a family.');
  const memberId = parseInt(ctx.params.id, 10);
  if (!Number.isInteger(memberId) || memberId <= 0) {
    throw errors.badRequest('Invalid member id.');
  }
  const diet = repos.family.getMemberDiet(ctx.familyId, memberId);
  if (!diet) throw errors.notFound('Member not found.');
  return diet;
}

function handleUpdateMemberDiet(ctx, repos) {
  if (!ctx.familyId) throw errors.forbidden('User is not currently in a family.');
  const memberId = parseInt(ctx.params.id, 10);
  if (!Number.isInteger(memberId) || memberId <= 0) {
    throw errors.badRequest('Invalid member id.');
  }
  const body = ctx.body || {};
  // Only pass through the 4 known fields; ignore unknowns to avoid
  // surprise behavior when clients send extra keys.
  const fields = {};
  if ('allergies' in body) fields.allergies = body.allergies;
  if ('dislikes' in body) fields.dislikes = body.dislikes;
  if ('dietTags' in body) fields.dietTags = body.dietTags;
  if ('customDietNote' in body) fields.customDietNote = body.customDietNote;
  try {
    const updated = repos.family.updateMemberDiet(ctx.familyId, memberId, fields);
    if (!updated) throw errors.notFound('Member not found.');
    return { ok: true, diet: updated };
  } catch (err) {
    if (err.status) throw err;
    throw errors.badRequest(err.message);
  }
}

// ============================================================
// Invitations
// ============================================================

function handleCreateInvitation(ctx, repos) {
  if (!ctx.familyId) throw errors.forbidden('User is not currently in a family.');
  if (!ctx.user || ctx.user._synthetic) {
    throw errors.forbidden('Synthetic local user cannot invite real accounts.');
  }
  const {
    role,
    profileMemberId = null,
    email = null,
    invitationMessage = null,
    locale = 'no',
  } = ctx.body || {};
  if (!['adult', 'child'].includes(role)) {
    throw errors.badRequest('role must be "adult" or "child".');
  }
  // Optional profile-member-id must belong to the same family.
  if (profileMemberId != null) {
    const members = repos.family.listMembers(ctx.familyId);
    if (!members.some((m) => m.id === profileMemberId)) {
      throw errors.badRequest('profileMemberId does not belong to this family.');
    }
  }
  // Email is required for the new flow but null is still accepted to
  // keep the legacy URL-share path working. validateEmailFormat enforces
  // the basic local@domain.tld shape; deeper validation (MX lookup etc)
  // is not done here — Resend will surface bounce later.
  let normalizedEmail = null;
  if (email != null) {
    if (typeof email !== 'string' || !validateEmailFormat(email)) {
      throw errors.badRequest('email is not a valid email address.');
    }
    normalizedEmail = email.trim().toLowerCase();
  }
  // Optional personal message from the inviter. Repo-cap is 500 chars;
  // we double-check at the route layer so a misbehaving client gets a
  // 400 instead of a 500.
  let normalizedMessage = null;
  if (invitationMessage != null) {
    if (typeof invitationMessage !== 'string') {
      throw errors.badRequest('invitationMessage must be a string or null.');
    }
    const trimmed = invitationMessage.trim();
    if (trimmed.length > MAX_INVITATION_MESSAGE_LENGTH) {
      throw errors.badRequest(
        `invitationMessage exceeds ${MAX_INVITATION_MESSAGE_LENGTH} characters.`
      );
    }
    normalizedMessage = trimmed === '' ? null : trimmed;
  }
  // Locale is the language the email + accept page render in. Default
  // 'no' matches the pilot's default; the frontend forwards i18n.language
  // when it has been switched.
  if (typeof locale !== 'string' || !VALID_INVITATION_LOCALES.includes(locale)) {
    throw errors.badRequest("locale must be 'no' or 'en'.");
  }

  // Per-family create-rate-limit. Counted via family.repo over the
  // last hour from family_invitations.created_at. Errors with
  // 429 + Retry-After so the UI can disable the submit button during
  // the cooldown window.
  const recentCount = repos.family.countRecentInvitations(ctx.familyId);
  if (recentCount >= CREATE_RATE_LIMIT_PER_HOUR) {
    if (ctx.res) ctx.res.setHeader('Retry-After', '3600');
    throw errors.tooManyRequests(
      `Too many invitations created in the last hour (${recentCount}/${CREATE_RATE_LIMIT_PER_HOUR}). Try again later.`
    );
  }

  // Pre-validation (only when an email was supplied — the legacy null-
  // email path is opaque and can't be deduplicated).
  if (normalizedEmail) {
    const existingMember = repos.family.findExistingMemberByEmail(ctx.familyId, normalizedEmail);
    if (existingMember) {
      throw errors.conflict('This email is already a member of the family.', {
        code: 'EMAIL_ALREADY_MEMBER',
      });
    }
    const pendingInvite = repos.family.findActiveInvitationByEmail(ctx.familyId, normalizedEmail);
    if (pendingInvite) {
      throw errors.conflict('This email already has a pending invitation.', {
        code: 'EMAIL_ALREADY_INVITED',
      });
    }
  }

  const token = randomToken(32);
  const invitation = repos.family.createInvitation({
    familyId: ctx.familyId,
    token,
    assignedRole: role,
    profileMemberId,
    invitedBy: ctx.user.id,
    ttlDays: INVITE_TTL_DAYS,
    invitedEmail: normalizedEmail,
    invitationMessage: normalizedMessage,
    locale,
  });

  // Email-delivery hook. When Resend is configured we send the
  // invitation email; otherwise the URL is logged so the operator can
  // copy it manually. The handler does not block on email failures —
  // if the send fails the invitation still exists and the URL is
  // returned in the response.
  if (invitation.invited_email) {
    sendInvitationEmailBestEffort({
      to: invitation.invited_email,
      url: invitationUrlFor(token),
      familyName: invitation.family_name || config.APP_NAME,
      inviterName: ctx.user?.name || ctx.user?.email || 'an existing member',
      invitationMessage: invitation.invitation_message,
      locale: invitation.locale || locale,
    });
  }

  auditInvitation(repos, ctx, 'invitation_sent', invitation);

  return {
    ok: true,
    invitation: {
      id: invitation.id,
      token,
      url: invitationUrlFor(token),
      assignedRole: invitation.assigned_role,
      profileMemberId: invitation.profile_member_id,
      invitedEmail: invitation.invited_email,
      invitationMessage: invitation.invitation_message,
      locale: invitation.locale,
      expiresAt: invitation.expires_at,
      createdAt: invitation.created_at,
    },
  };
}

function handleResendInvitation(ctx, repos) {
  if (!ctx.familyId) throw errors.forbidden('User is not currently in a family.');
  if (!ctx.user || ctx.user._synthetic) {
    throw errors.forbidden('Synthetic local user cannot resend invitations.');
  }
  const invitationId = parseInt(ctx.params.id, 10);
  if (!Number.isInteger(invitationId) || invitationId <= 0) {
    throw errors.badRequest('Invalid invitation id.');
  }
  // Look up the existing row to verify both family-scoping and that we
  // are not resending a finalised (accepted/revoked) invitation. The
  // resendInvitation() repo call also enforces both invariants in its
  // WHERE clause, but checking here gives us a clean 404 vs 409 split
  // without round-tripping a token-rotation we'd then have to undo.
  const existing = repos.family.findInvitationById(ctx.familyId, invitationId);
  if (!existing) throw errors.notFound('Invitation not found.');
  if (existing.accepted_at) {
    throw errors.conflict('Cannot resend an accepted invitation.', {
      code: 'INVITATION_ACCEPTED',
    });
  }
  if (existing.revoked_at) {
    throw errors.conflict('Cannot resend a revoked invitation.', {
      code: 'INVITATION_REVOKED',
    });
  }

  // Per-invitation resend cooldown. expires_at is rewritten to "now +
  // INVITE_TTL_DAYS" on every create AND every resend, so subtracting
  // INVITE_TTL_DAYS recovers the timestamp of the most recent activity
  // on this row. If that activity was less than RESEND_COOLDOWN_MS ago,
  // reject with 429 + Retry-After so the UI can show a countdown.
  const expiresMs = Date.parse(`${existing.expires_at.replace(' ', 'T')}Z`);
  const lastActivityMs = expiresMs - INVITE_TTL_DAYS * 86400000;
  const sinceLastMs = Date.now() - lastActivityMs;
  if (sinceLastMs < RESEND_COOLDOWN_MS) {
    const retryAfterSec = Math.max(1, Math.ceil((RESEND_COOLDOWN_MS - sinceLastMs) / 1000));
    if (ctx.res) ctx.res.setHeader('Retry-After', String(retryAfterSec));
    throw errors.tooManyRequests(`Resend cooldown active. Try again in ${retryAfterSec}s.`);
  }

  const newToken = randomToken(32);
  const updated = repos.family.resendInvitation(
    ctx.familyId,
    invitationId,
    newToken,
    INVITE_TTL_DAYS
  );
  if (!updated) {
    // Race condition — invitation finalised between read and write.
    throw errors.conflict('Invitation could not be resent.', {
      code: 'INVITATION_RACE',
    });
  }

  if (updated.invited_email) {
    sendInvitationEmailBestEffort({
      to: updated.invited_email,
      url: invitationUrlFor(newToken),
      familyName: updated.family_name || config.APP_NAME,
      inviterName: ctx.user?.name || ctx.user?.email || 'an existing member',
      invitationMessage: updated.invitation_message,
      locale: updated.locale || 'no',
    });
  }

  auditInvitation(repos, ctx, 'invitation_resent', updated);

  return {
    ok: true,
    invitation: {
      id: updated.id,
      token: newToken,
      url: invitationUrlFor(newToken),
      assignedRole: updated.assigned_role,
      profileMemberId: updated.profile_member_id,
      invitedEmail: updated.invited_email,
      invitationMessage: updated.invitation_message,
      locale: updated.locale,
      expiresAt: updated.expires_at,
      createdAt: updated.created_at,
    },
  };
}

function handleListInvitations(ctx, repos) {
  if (!ctx.familyId) throw errors.forbidden('User is not currently in a family.');
  const rows = repos.family.listActiveInvitations(ctx.familyId);
  // Migration 030: token is stored as SHA-256 hash and the plain token
  // is irrecoverable after creation. The listing endpoint therefore no
  // longer carries `token` or `url` — both are returned one-shot from
  // the create- and resend-handlers as part of the invitation response.
  // The owner-facing PendingInvitationsList UI never rendered them
  // anyway (it shows email + relative times + resend/revoke actions).
  return {
    invitations: rows.map((r) => ({
      id: r.id,
      assignedRole: r.assignedRole,
      profileMemberId: r.profileMemberId,
      invitedEmail: r.invitedEmail,
      invitationMessage: r.invitationMessage,
      locale: r.locale,
      expiresAt: r.expiresAt,
      createdAt: r.createdAt,
    })),
  };
}

function handleRevokeInvitation(ctx, repos) {
  if (!ctx.familyId) throw errors.forbidden('User is not currently in a family.');
  const invitationId = parseInt(ctx.params.id, 10);
  if (!Number.isInteger(invitationId) || invitationId <= 0) {
    throw errors.badRequest('Invalid invitation id.');
  }
  // Snapshot the row before revoke so the audit-log entry can record
  // which invitation was revoked (id + email + locale). The repo call
  // below is the authoritative state-change; if it returns false (race
  // condition or already-finalised) we surface notFound and skip the
  // audit-log entry.
  const before = repos.family.findInvitationById(ctx.familyId, invitationId);
  const ok = repos.family.revokeInvitation(ctx.familyId, invitationId);
  if (!ok) throw errors.notFound('Invitation not found or already finalised.');
  auditInvitation(repos, ctx, 'invitation_revoked', before);
  return { ok: true };
}

// Public peek — used by the /invite/:token page to preview who is
// inviting before the user authenticates. The response intentionally
// includes the personal invitation_message + locale so the accept-page
// can render in the same language the email arrived in. invitedEmail is
// also returned so the page can detect a "logged-in with the wrong
// account" mismatch (state 4 in the 5-state machine) without an extra
// fetch.
function handlePeekInvitation(ctx, repos) {
  const token = ctx.params.token;
  if (!token) throw errors.badRequest('Missing token.');
  const inv = repos.family.findInvitationByToken(token);
  if (!inv) throw errors.notFound('Invitation not found.');
  if (inv.revoked_at) {
    throw errors.gone('This invitation has been revoked.', {
      code: 'INVITATION_REVOKED',
    });
  }
  if (inv.accepted_at) {
    throw errors.conflict('This invitation has already been accepted.', {
      code: 'INVITATION_ACCEPTED',
    });
  }
  if (Date.parse(inv.expires_at.replace(' ', 'T') + 'Z') < Date.now()) {
    throw errors.gone('This invitation has expired.', { code: 'INVITATION_EXPIRED' });
  }
  return {
    familyId: inv.family_id,
    familyName: inv.family_name,
    assignedRole: inv.assigned_role,
    inviterName: inv.inviter_name,
    inviterEmail: inv.inviter_email,
    invitedEmail: inv.invited_email,
    invitationMessage: inv.invitation_message,
    locale: inv.locale,
    expiresAt: inv.expires_at,
  };
}

function handleAcceptInvitation(ctx, repos) {
  if (!ctx.user || ctx.user._synthetic) {
    throw errors.unauthorized('Log in before accepting an invitation.');
  }
  const token = ctx.params.token;
  if (!token) throw errors.badRequest('Missing token.');
  const inv = repos.family.findInvitationByToken(token);
  if (!inv) throw errors.notFound('Invitation not found.');
  if (inv.revoked_at) {
    throw errors.gone('This invitation has been revoked.', {
      code: 'INVITATION_REVOKED',
    });
  }
  if (inv.accepted_at) {
    throw errors.conflict('This invitation has already been accepted.', {
      code: 'INVITATION_ACCEPTED',
    });
  }
  if (Date.parse(inv.expires_at.replace(' ', 'T') + 'Z') < Date.now()) {
    throw errors.gone('This invitation has expired.', { code: 'INVITATION_EXPIRED' });
  }

  // Email-match check. When the invitation was sent to a specific
  // email, only the user with that email may accept. The frontend's
  // 5-state machine renders state 4 ("logged in with the wrong
  // account") to prevent this from ever reaching the API; this
  // backend check is the second line of defence so a forged client
  // cannot bypass the UI.
  if (inv.invited_email) {
    const userEmail = (ctx.user.email || '').trim().toLowerCase();
    if (userEmail !== inv.invited_email) {
      throw errors.forbidden('This invitation is addressed to a different email.');
    }
  }

  // Users belong to one family only. If the user is already in a family, they
  // must leave it explicitly before joining a new one — prevents accidental
  // data orphaning.
  if (ctx.user.family_id && ctx.user.family_id !== inv.family_id) {
    throw errors.conflict('Leave your current family before joining a new one.');
  }

  const updated = repos.auth.setFamily(
    ctx.user.id,
    inv.family_id,
    inv.assigned_role,
    inv.profile_member_id || null
  );
  repos.family.acceptInvitation(inv.id, ctx.user.id);

  auditInvitation(repos, ctx, 'invitation_accepted', inv, {
    acceptedByUserId: ctx.user.id,
  });

  return {
    ok: true,
    user: {
      id: updated.id,
      email: updated.email,
      name: updated.name,
      role: updated.role,
      familyId: updated.family_id,
      profileMemberId: updated.profile_member_id,
    },
    family: {
      id: inv.family_id,
      name: inv.family_name,
    },
  };
}

// ============================================================
// Member-user management
// ============================================================

function handleRemoveUserFromFamily(ctx, repos) {
  if (!ctx.familyId) throw errors.forbidden('User is not currently in a family.');
  const userId = parseInt(ctx.params.userId, 10);
  if (!Number.isInteger(userId) || userId <= 0) {
    throw errors.badRequest('Invalid user id.');
  }
  if (userId === ctx.user.id) {
    throw errors.badRequest('Owners cannot remove themselves — use transfer-ownership first.');
  }
  const target = repos.auth.findById(userId);
  if (!target || target.family_id !== ctx.familyId) {
    throw errors.notFound('User not in this family.');
  }
  repos.auth.setFamily(userId, null, 'adult', null);
  repos.auth.deleteAllForUser(userId);
  return { ok: true };
}

function handleLeaveFamily(ctx, repos) {
  if (!ctx.user || ctx.user._synthetic) {
    throw errors.forbidden('Synthetic local user cannot leave a family.');
  }
  if (!ctx.user.family_id) {
    throw errors.badRequest('You are not currently in a family.');
  }
  if (ctx.user.role === 'owner') {
    throw errors.forbidden('Owners must transfer ownership before leaving the family.');
  }
  repos.auth.setFamily(ctx.user.id, null, 'adult', null);
  repos.auth.deleteAllForUser(ctx.user.id);
  return { ok: true };
}

function handleTransferOwnership(ctx, repos) {
  if (!ctx.familyId) throw errors.forbidden('User is not currently in a family.');
  const { userId } = ctx.body || {};
  if (!Number.isInteger(userId) || userId <= 0) {
    throw errors.badRequest('userId is required.');
  }
  if (userId === ctx.user.id) {
    throw errors.badRequest('You already own the family.');
  }
  const target = repos.auth.findById(userId);
  if (!target || target.family_id !== ctx.familyId) {
    throw errors.notFound('Target user not in this family.');
  }
  if (target.role === 'child') {
    throw errors.forbidden('Ownership can only be transferred to an adult.');
  }

  repos._db.transaction(() => {
    repos.auth.setRole(target.id, 'owner');
    repos.auth.setRole(ctx.user.id, 'adult');
    repos.family.setOwner(ctx.familyId, target.id);
  })();

  return {
    ok: true,
    newOwnerId: target.id,
    previousOwnerId: ctx.user.id,
  };
}

function handleChangeUserRole(ctx, repos) {
  if (!ctx.familyId) throw errors.forbidden('User is not currently in a family.');
  const userId = parseInt(ctx.params.userId, 10);
  if (!Number.isInteger(userId) || userId <= 0) {
    throw errors.badRequest('Invalid user id.');
  }
  const { role } = ctx.body || {};
  if (!['adult', 'child'].includes(role)) {
    throw errors.badRequest('role must be "adult" or "child". Use transfer-ownership for owner.');
  }
  const target = repos.auth.findById(userId);
  if (!target || target.family_id !== ctx.familyId) {
    throw errors.notFound('User not in this family.');
  }
  if (target.role === 'owner') {
    throw errors.forbidden('Owner role can only be changed via transfer-ownership.');
  }
  const updated = repos.auth.setRole(userId, role);
  return {
    ok: true,
    user: { id: updated.id, role: updated.role },
  };
}

function handleDeleteFamily(ctx, repos) {
  if (!ctx.familyId) throw errors.forbidden('User is not currently in a family.');
  const family = repos.family.findFamilyById(ctx.familyId);
  if (!family) throw errors.notFound('Family not found.');
  const confirmation = (ctx.body?.confirmationName || '').trim();
  if (confirmation !== family.name) {
    throw errors.badRequest('Type the exact family name in confirmationName to confirm deletion.');
  }
  repos.family.deleteFamily(ctx.familyId);
  return { ok: true };
}

// ============================================================
// Registration
// ============================================================

function registerFamilyRoutes(router, { repos }) {
  // Family basics — read is any role, rename/delete is owner.
  router.get('/api/family', (ctx) => handleGetFamily(ctx, repos));
  router.put('/api/family', requireRole('owner'), (ctx) => handleRenameFamily(ctx, repos));
  router.delete('/api/family', requireRole('owner'), (ctx) => handleDeleteFamily(ctx, repos));
  router.patch(
    '/api/family/gamification',
    requireRole('owner'),
    validateBody(schemas.familyGamificationBody),
    (ctx) => handlePatchGamification(ctx, repos)
  );
  router.get('/api/family/backup', requireRole('owner'), (ctx) => handleGetBackup(ctx, repos));
  router.post(
    '/api/family/backup/import',
    requireRole('owner'),
    validateBody(schemas.familyBackupImportBody),
    (ctx) => handleImportBackup(ctx, repos)
  );

  // Profile members (roster rows) — add/update is adult, delete is owner.
  router.post('/api/family/members', requireRole('adult'), (ctx) => handleAddMember(ctx, repos));
  router.put('/api/family/members/:id', requireRole('adult'), (ctx) =>
    handleUpdateMember(ctx, repos)
  );
  router.delete('/api/family/members/:id', requireRole('owner'), (ctx) =>
    handleDeleteMember(ctx, repos)
  );

  // B7 — Per-member diet. Read is any role (kids can view their own diet
  // card), but edit is adult-only (children shouldn't mutate safety data).
  router.get('/api/family/members/:id/diet', (ctx) => handleGetMemberDiet(ctx, repos));
  router.put('/api/family/members/:id/diet', requireRole('adult'), (ctx) =>
    handleUpdateMemberDiet(ctx, repos)
  );

  // Invitations — owner-only create/list/revoke.
  router.post('/api/family/invitations', requireRole('owner'), (ctx) =>
    handleCreateInvitation(ctx, repos)
  );
  router.get('/api/family/invitations', requireRole('owner'), (ctx) =>
    handleListInvitations(ctx, repos)
  );
  router.delete('/api/family/invitations/:id', requireRole('owner'), (ctx) =>
    handleRevokeInvitation(ctx, repos)
  );
  router.post('/api/family/invitations/:id/resend', requireRole('owner'), (ctx) =>
    handleResendInvitation(ctx, repos)
  );

  // Public peek + authenticated accept.
  router.get('/api/invitations/:token', (ctx) => handlePeekInvitation(ctx, repos));
  router.post('/api/invitations/:token/accept', (ctx) => handleAcceptInvitation(ctx, repos));

  // Member-user management.
  router.delete('/api/family/members/users/:userId', requireRole('owner'), (ctx) =>
    handleRemoveUserFromFamily(ctx, repos)
  );
  router.post('/api/family/leave', (ctx) => handleLeaveFamily(ctx, repos));
  router.post('/api/family/transfer-ownership', requireRole('owner'), (ctx) =>
    handleTransferOwnership(ctx, repos)
  );
  router.put('/api/family/members/users/:userId/role', requireRole('owner'), (ctx) =>
    handleChangeUserRole(ctx, repos)
  );
}

module.exports = { registerFamilyRoutes };
