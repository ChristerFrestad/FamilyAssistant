// Repository for families, family-profile-members and invitations.
//
// These rows are family-scoped but the queries use explicit family id
// arguments instead of AsyncLocalStorage so callers can operate on
// arbitrary families (accepting an invitation, creating the first family
// for a new user, listing members of a family you are about to join).
//
// All UPDATE/DELETE helpers are constrained by family_id to prevent a
// caller with the wrong id from mutating another family's rows even if
// the auth layer ever lets something through.

function createFamilyRepo(db) {
  // ============================================================
  // families
  // ============================================================

  const insertFamilyStmt = db.prepare('INSERT INTO families (name) VALUES (?)');
  const findFamilyByIdStmt = db.prepare('SELECT * FROM families WHERE id = ?');
  const updateFamilyNameStmt = db.prepare(
    "UPDATE families SET name = ?, updated_at = datetime('now') WHERE id = ?"
  );
  const setOwnerStmt = db.prepare('UPDATE families SET owner_user_id = ? WHERE id = ?');
  const deleteFamilyStmt = db.prepare('DELETE FROM families WHERE id = ?');

  function createFamily(name, ownerUserId = null) {
    if (typeof name !== 'string' || !name.trim()) {
      throw new Error('createFamily: name is required');
    }
    const res = insertFamilyStmt.run(name.trim());
    const id = Number(res.lastInsertRowid);
    if (ownerUserId) setOwnerStmt.run(ownerUserId, id);
    return findFamilyByIdStmt.get(id);
  }

  function findFamilyById(id) {
    if (!Number.isInteger(id) || id <= 0) return null;
    return findFamilyByIdStmt.get(id) || null;
  }

  function renameFamily(id, name) {
    if (typeof name !== 'string' || !name.trim()) {
      throw new Error('renameFamily: name is required');
    }
    updateFamilyNameStmt.run(name.trim(), id);
    return findFamilyById(id);
  }

  function setOwner(id, userId) {
    setOwnerStmt.run(userId, id);
  }

  function deleteFamily(id) {
    // CASCADE from migration 014 removes all scoped rows (inventory, meal
    // plans, etc.) automatically.
    deleteFamilyStmt.run(id);
  }

  // ============================================================
  // family_profile_members (name-only roster rows)
  // ============================================================

  const insertMemberStmt = db.prepare(
    `INSERT INTO family_profile_members (family_id, name, category, portion_factor, sort_order)
     VALUES (?, ?, ?, ?, ?)`
  );
  // Members include raw JSON-TEXT columns allergies/dislikes/diet_tags and the
  // plain-text custom_diet_note. parseMemberRow() below parses the JSON layers
  // so callers receive arrays (or null for allergies/dislikes when "inherit
  // from family_profile" — see migration 020 header for fallback semantics).
  const listMembersStmt = db.prepare(
    `SELECT id, name, category, portion_factor AS portionFactor, sort_order AS sortOrder,
            allergies, dislikes, diet_tags AS dietTags, custom_diet_note AS customDietNote,
            created_at AS createdAt, updated_at AS updatedAt
       FROM family_profile_members
      WHERE family_id = ?
      ORDER BY sort_order, id`
  );
  const findMemberStmt = db.prepare(
    `SELECT id, name, category, portion_factor AS portionFactor, sort_order AS sortOrder,
            allergies, dislikes, diet_tags AS dietTags, custom_diet_note AS customDietNote,
            created_at AS createdAt, updated_at AS updatedAt
       FROM family_profile_members
      WHERE family_id = ? AND id = ?`
  );
  const updateMemberStmt = db.prepare(
    `UPDATE family_profile_members
        SET name = ?, category = ?, portion_factor = ?, sort_order = ?,
            updated_at = datetime('now')
      WHERE family_id = ? AND id = ?`
  );
  const deleteMemberStmt = db.prepare(
    'DELETE FROM family_profile_members WHERE family_id = ? AND id = ?'
  );
  const maxSortStmt = db.prepare(
    'SELECT COALESCE(MAX(sort_order), -1) AS m FROM family_profile_members WHERE family_id = ?'
  );

  // B7 — prepared statement that updates ONLY diet fields. The existing
  // updateMember() stmt omits these columns so roster edits (name/category/
  // portion) never clobber diet data, and this stmt omits name/category/
  // portion so diet edits never clobber roster data.
  const updateMemberDietStmt = db.prepare(
    `UPDATE family_profile_members
        SET allergies = ?, dislikes = ?, diet_tags = ?, custom_diet_note = ?,
            updated_at = datetime('now')
      WHERE family_id = ? AND id = ?`
  );

  // B7 — D3 enum list of allowed diet_tags. Validated in repo rather than
  // at DB level so adding a new tag later (e.g. 'mediterranean') does not
  // require a migration. Matches filter_usage filter-IDs where overlap exists.
  const VALID_DIET_TAGS = Object.freeze([
    'vegetarian',
    'vegan',
    'pescetarian',
    'halal',
    'kosher',
    'laktosefri',
    'glutenfri',
    'eggfri',
    'nøttefri',
    'lavkarbo',
    'lchf',
    'keto',
    'lav-fodmap',
  ]);
  const VALID_DIET_TAG_SET = new Set(VALID_DIET_TAGS);

  function safeJsonParse(text, fallback) {
    if (text == null) return fallback;
    try {
      const v = JSON.parse(text);
      return v == null ? fallback : v;
    } catch {
      return fallback;
    }
  }

  // Parses the JSON-TEXT columns on a raw member row. Returns:
  //   allergies: string[] | null   (null = inherit from family_profile)
  //   dislikes:  string[] | null   (null = inherit from family_profile)
  //   dietTags:  string[]          (never null, [] means "no diet filters")
  //   customDietNote: string | null
  function parseMemberRow(row) {
    if (!row) return row;
    return Object.assign({}, row, {
      allergies: row.allergies == null ? null : safeJsonParse(row.allergies, null),
      dislikes: row.dislikes == null ? null : safeJsonParse(row.dislikes, null),
      dietTags: safeJsonParse(row.dietTags, []),
    });
  }

  function addMember(familyId, { name, category = 'adult', portionFactor = 1.0, sortOrder }) {
    if (!name || typeof name !== 'string') throw new Error('addMember: name is required');
    if (!['adult', 'teen', 'child'].includes(category)) {
      throw new Error(`addMember: invalid category ${category}`);
    }
    if (portionFactor < 0.1 || portionFactor > 2.0) {
      throw new Error('addMember: portionFactor must be between 0.1 and 2.0');
    }
    const sort = sortOrder != null ? sortOrder : maxSortStmt.get(familyId).m + 1;
    const res = insertMemberStmt.run(familyId, name, category, portionFactor, sort);
    return parseMemberRow(findMemberStmt.get(familyId, Number(res.lastInsertRowid)));
  }

  function listMembers(familyId) {
    return listMembersStmt.all(familyId).map(parseMemberRow);
  }

  function updateMember(familyId, memberId, fields) {
    const current = findMemberStmt.get(familyId, memberId);
    if (!current) return null;
    const name = fields.name ?? current.name;
    const category = fields.category ?? current.category;
    const portionFactor = fields.portionFactor ?? current.portionFactor;
    const sortOrder = fields.sortOrder ?? current.sortOrder;
    if (!['adult', 'teen', 'child'].includes(category)) {
      throw new Error(`updateMember: invalid category ${category}`);
    }
    if (portionFactor < 0.1 || portionFactor > 2.0) {
      throw new Error('updateMember: portionFactor must be between 0.1 and 2.0');
    }
    updateMemberStmt.run(name, category, portionFactor, sortOrder, familyId, memberId);
    return parseMemberRow(findMemberStmt.get(familyId, memberId));
  }

  function deleteMember(familyId, memberId) {
    // Detach any login user that was linked to this profile row — the user
    // still exists but no longer has a roster slot.
    db.prepare(
      `UPDATE users SET profile_member_id = NULL
        WHERE family_id = ? AND profile_member_id = ?`
    ).run(familyId, memberId);
    deleteMemberStmt.run(familyId, memberId);
  }

  function portionSum(familyId) {
    const row = db
      .prepare(
        'SELECT COALESCE(SUM(portion_factor), 0) AS s FROM family_profile_members WHERE family_id = ?'
      )
      .get(familyId);
    return row.s || 0;
  }

  // ============================================================
  // B7 — per-member diet (allergies/dislikes/diet_tags/custom_diet_note)
  // ============================================================
  //
  // Fallback semantics (migration 020):
  //   allergies = null → inherit from family_profile.allergies
  //   allergies = []   → explicit "no allergies" (no fallback)
  //   Same for dislikes. diet_tags has NO fallback — personal lifestyle.
  //
  // Update semantics:
  //   fields[key] === undefined → keep existing value
  //   fields[key] === null      → clear to NULL (allergies/dislikes) or
  //                               '[]' (dietTags) or NULL (customDietNote)
  //   fields[key] === array/str → replace with new value

  function getMemberDiet(familyId, memberId) {
    const row = findMemberStmt.get(familyId, memberId);
    if (!row) return null;
    const parsed = parseMemberRow(row);
    return {
      memberId: parsed.id,
      name: parsed.name,
      allergies: parsed.allergies,
      dislikes: parsed.dislikes,
      dietTags: parsed.dietTags,
      customDietNote: parsed.customDietNote ?? null,
    };
  }

  function updateMemberDiet(familyId, memberId, fields) {
    const current = findMemberStmt.get(familyId, memberId);
    if (!current) return null;

    // allergies: null | array | undefined
    let allergiesText;
    if (fields.allergies === undefined) {
      allergiesText = current.allergies; // keep raw TEXT (or NULL) from DB
    } else if (fields.allergies === null) {
      allergiesText = null;
    } else {
      if (!Array.isArray(fields.allergies)) {
        throw new Error('updateMemberDiet: allergies must be null or array');
      }
      const cleaned = fields.allergies
        .filter((a) => typeof a === 'string' && a.trim())
        .map((a) => a.trim());
      allergiesText = JSON.stringify(cleaned);
    }

    // dislikes: null | array | undefined
    let dislikesText;
    if (fields.dislikes === undefined) {
      dislikesText = current.dislikes;
    } else if (fields.dislikes === null) {
      dislikesText = null;
    } else {
      if (!Array.isArray(fields.dislikes)) {
        throw new Error('updateMemberDiet: dislikes must be null or array');
      }
      const cleaned = fields.dislikes
        .filter((d) => typeof d === 'string' && d.trim())
        .map((d) => d.trim());
      dislikesText = JSON.stringify(cleaned);
    }

    // dietTags: array | null | undefined; NOT NULL in DB (defaults to '[]')
    let dietTagsText;
    if (fields.dietTags === undefined) {
      dietTagsText = current.dietTags; // keep raw TEXT from DB
    } else if (fields.dietTags === null) {
      dietTagsText = '[]';
    } else {
      if (!Array.isArray(fields.dietTags)) {
        throw new Error('updateMemberDiet: dietTags must be null or array');
      }
      const invalid = fields.dietTags.filter(
        (t) => typeof t !== 'string' || !VALID_DIET_TAG_SET.has(t)
      );
      if (invalid.length > 0) {
        throw new Error(
          `updateMemberDiet: invalid dietTags: ${invalid.join(', ')}. ` +
            `Allowed: ${VALID_DIET_TAGS.join(', ')}`
        );
      }
      // Deduplicate while preserving order
      const unique = Array.from(new Set(fields.dietTags));
      dietTagsText = JSON.stringify(unique);
    }

    // customDietNote: string | null | undefined; empty string coerces to NULL
    let customDietNote;
    if (fields.customDietNote === undefined) {
      customDietNote = current.customDietNote;
    } else if (fields.customDietNote === null) {
      customDietNote = null;
    } else {
      if (typeof fields.customDietNote !== 'string') {
        throw new Error('updateMemberDiet: customDietNote must be null or string');
      }
      const trimmed = fields.customDietNote.trim();
      customDietNote = trimmed === '' ? null : trimmed;
    }

    updateMemberDietStmt.run(
      allergiesText,
      dislikesText,
      dietTagsText,
      customDietNote,
      familyId,
      memberId
    );
    return getMemberDiet(familyId, memberId);
  }

  // ============================================================
  // family_invitations
  // ============================================================

  const insertInvitationStmt = db.prepare(
    `INSERT INTO family_invitations
       (family_id, token, assigned_role, profile_member_id, invited_by, expires_at, invited_email)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const findInvitationByTokenStmt = db.prepare(
    `SELECT fi.*, f.name AS family_name, u.name AS inviter_name, u.email AS inviter_email
       FROM family_invitations fi
       JOIN families f ON f.id = fi.family_id
       LEFT JOIN users u ON u.id = fi.invited_by
      WHERE fi.token = ?`
  );
  const findInvitationByIdStmt = db.prepare(
    'SELECT * FROM family_invitations WHERE id = ? AND family_id = ?'
  );
  const listActiveForFamilyStmt = db.prepare(
    `SELECT id, token, assigned_role AS assignedRole,
            profile_member_id AS profileMemberId,
            invited_by AS invitedBy,
            expires_at AS expiresAt, accepted_at AS acceptedAt,
            accepted_by AS acceptedBy, revoked_at AS revokedAt,
            created_at AS createdAt
       FROM family_invitations
      WHERE family_id = ?
        AND accepted_at IS NULL
        AND revoked_at IS NULL
        AND expires_at > datetime('now')
      ORDER BY created_at DESC`
  );
  const markAcceptedStmt = db.prepare(
    `UPDATE family_invitations
        SET accepted_at = datetime('now'), accepted_by = ?
      WHERE id = ? AND accepted_at IS NULL AND revoked_at IS NULL`
  );
  const revokeInvitationStmt = db.prepare(
    `UPDATE family_invitations
        SET revoked_at = datetime('now')
      WHERE id = ? AND family_id = ? AND accepted_at IS NULL AND revoked_at IS NULL`
  );

  function createInvitation({
    familyId,
    token,
    assignedRole,
    profileMemberId = null,
    invitedBy,
    ttlDays = 7,
    invitedEmail = null,
  }) {
    if (!['adult', 'child'].includes(assignedRole)) {
      throw new Error(`createInvitation: invalid role ${assignedRole}`);
    }
    const expiresAt = new Date(Date.now() + ttlDays * 86400000)
      .toISOString()
      .replace('T', ' ')
      .slice(0, 19);
    insertInvitationStmt.run(
      familyId,
      token,
      assignedRole,
      profileMemberId,
      invitedBy,
      expiresAt,
      invitedEmail ? String(invitedEmail).trim().toLowerCase() : null
    );
    return findInvitationByTokenStmt.get(token);
  }

  function findInvitationByToken(token) {
    if (!token) return null;
    return findInvitationByTokenStmt.get(token) || null;
  }

  function listActiveInvitations(familyId) {
    return listActiveForFamilyStmt.all(familyId);
  }

  function acceptInvitation(invitationId, userId) {
    const info = markAcceptedStmt.run(userId, invitationId);
    return info.changes > 0;
  }

  function revokeInvitation(familyId, invitationId) {
    const info = revokeInvitationStmt.run(invitationId, familyId);
    return info.changes > 0;
  }

  function findInvitationById(familyId, invitationId) {
    return findInvitationByIdStmt.get(invitationId, familyId) || null;
  }

  return {
    // families
    createFamily,
    findFamilyById,
    renameFamily,
    setOwner,
    deleteFamily,
    // members
    addMember,
    listMembers,
    updateMember,
    deleteMember,
    portionSum,
    // B7 — per-member diet
    getMemberDiet,
    updateMemberDiet,
    VALID_DIET_TAGS,
    // invitations
    createInvitation,
    findInvitationByToken,
    findInvitationById,
    listActiveInvitations,
    acceptInvitation,
    revokeInvitation,
  };
}

module.exports = { createFamilyRepo };
