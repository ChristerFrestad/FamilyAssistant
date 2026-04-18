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

const INVITE_URL_PATH = '/invite/';
const INVITE_TTL_DAYS = 7;

function invitationUrlFor(token) {
  const base = (config.APP_URL || '').replace(/\/+$/, '');
  const path = `${INVITE_URL_PATH}${encodeURIComponent(token)}`;
  return base ? `${base}${path}` : path;
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
// Invitations
// ============================================================

function handleCreateInvitation(ctx, repos) {
  if (!ctx.familyId) throw errors.forbidden('User is not currently in a family.');
  if (!ctx.user || ctx.user._synthetic) {
    throw errors.forbidden('Synthetic local user cannot invite real accounts.');
  }
  const { role, profileMemberId = null } = ctx.body || {};
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
  const token = randomToken(32);
  const invitation = repos.family.createInvitation({
    familyId: ctx.familyId,
    token,
    assignedRole: role,
    profileMemberId,
    invitedBy: ctx.user.id,
    ttlDays: INVITE_TTL_DAYS,
  });
  return {
    ok: true,
    invitation: {
      id: invitation.id,
      token,
      url: invitationUrlFor(token),
      assignedRole: invitation.assigned_role,
      profileMemberId: invitation.profile_member_id,
      expiresAt: invitation.expires_at,
      createdAt: invitation.created_at,
    },
  };
}

function handleListInvitations(ctx, repos) {
  if (!ctx.familyId) throw errors.forbidden('User is not currently in a family.');
  const rows = repos.family.listActiveInvitations(ctx.familyId);
  return {
    invitations: rows.map((r) => ({
      id: r.id,
      token: r.token,
      url: invitationUrlFor(r.token),
      assignedRole: r.assignedRole,
      profileMemberId: r.profileMemberId,
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
  const ok = repos.family.revokeInvitation(ctx.familyId, invitationId);
  if (!ok) throw errors.notFound('Invitation not found or already finalised.');
  return { ok: true };
}

// Public peek — used by the /invite/:token page to preview who is inviting
// before the user authenticates.
function handlePeekInvitation(ctx, repos) {
  const token = ctx.params.token;
  if (!token) throw errors.badRequest('Missing token.');
  const inv = repos.family.findInvitationByToken(token);
  if (!inv) throw errors.notFound('Invitation not found.');
  if (inv.revoked_at) throw errors.forbidden('This invitation has been revoked.');
  if (inv.accepted_at) throw errors.forbidden('This invitation has already been accepted.');
  if (Date.parse(inv.expires_at.replace(' ', 'T') + 'Z') < Date.now()) {
    throw errors.forbidden('This invitation has expired.');
  }
  return {
    familyId: inv.family_id,
    familyName: inv.family_name,
    assignedRole: inv.assigned_role,
    inviterName: inv.inviter_name,
    inviterEmail: inv.inviter_email,
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
  if (inv.revoked_at) throw errors.forbidden('This invitation has been revoked.');
  if (inv.accepted_at) {
    // 409 — caller should refresh.
    throw errors.conflict('This invitation has already been accepted.');
  }
  if (Date.parse(inv.expires_at.replace(' ', 'T') + 'Z') < Date.now()) {
    throw errors.forbidden('This invitation has expired.');
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

  // Profile members (roster rows) — add/update is adult, delete is owner.
  router.post('/api/family/members', requireRole('adult'), (ctx) => handleAddMember(ctx, repos));
  router.put('/api/family/members/:id', requireRole('adult'), (ctx) =>
    handleUpdateMember(ctx, repos)
  );
  router.delete('/api/family/members/:id', requireRole('owner'), (ctx) =>
    handleDeleteMember(ctx, repos)
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
