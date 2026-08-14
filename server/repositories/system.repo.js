'use strict';

const { getFamilyId } = require('../auth/family-context');

function createSystemRepos(db, tryParseJson) {
  const hasFTS = (() => {
    try {
      return (
        db
          .prepare(
            `SELECT name FROM sqlite_master WHERE type='table' AND name='knowledge_base_fts'`
          )
          .get() != null
      );
    } catch {
      return false;
    }
  })();

  const kb = {
    insert(entry) {
      const familyId = getFamilyId();
      return db
        .prepare(
          `
        INSERT INTO knowledge_base (family_id, timestamp, user_message, ai_response, context_json, intent, entities_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `
        )
        .run(
          familyId,
          entry.timestamp || new Date().toISOString(),
          entry.userMessage,
          entry.aiResponse,
          entry.context ? JSON.stringify(entry.context) : null,
          entry.intent || null,
          entry.entities ? JSON.stringify(entry.entities) : null
        ).lastInsertRowid;
    },
    search(query, limit = 10) {
      const familyId = getFamilyId();
      if (hasFTS && query && query.trim()) {
        const safe = query
          .replace(/["']/g, '')
          .split(/\s+/)
          .filter(Boolean)
          .map((t) => `${t}*`)
          .join(' OR ');
        if (!safe) return [];
        try {
          return db
            .prepare(
              `
            SELECT kb.* FROM knowledge_base kb
            JOIN knowledge_base_fts fts ON fts.rowid = kb.id
            WHERE kb.family_id = ? AND knowledge_base_fts MATCH ?
            ORDER BY bm25(knowledge_base_fts) LIMIT ?
          `
            )
            .all(familyId, safe, limit);
        } catch {
          /* fall through to LIKE */
        }
      }
      const like = `%${query}%`;
      return db
        .prepare(
          `
        SELECT * FROM knowledge_base
        WHERE family_id = ? AND (user_message LIKE ? OR ai_response LIKE ?)
        ORDER BY timestamp DESC LIMIT ?
      `
        )
        .all(familyId, like, like, limit);
    },
    getRecent(limit = 20) {
      const familyId = getFamilyId();
      return db
        .prepare('SELECT * FROM knowledge_base WHERE family_id = ? ORDER BY timestamp DESC LIMIT ?')
        .all(familyId, limit);
    },
    count() {
      const familyId = getFamilyId();
      return db
        .prepare('SELECT COUNT(*) as c FROM knowledge_base WHERE family_id = ?')
        .get(familyId).c;
    },
  };

  const notifications = {
    insert(type, message, data = null) {
      const familyId = getFamilyId();
      db.prepare(
        `
        INSERT INTO notifications (family_id, type, message, data_json) VALUES (?, ?, ?, ?)
      `
      ).run(familyId, type, message, data ? JSON.stringify(data) : null);
    },
    getUnread() {
      const familyId = getFamilyId();
      return db
        .prepare(
          `SELECT * FROM notifications WHERE family_id = ? AND read = 0 ORDER BY created_at DESC`
        )
        .all(familyId);
    },
    markAllRead() {
      const familyId = getFamilyId();
      db.prepare(`UPDATE notifications SET read = 1 WHERE family_id = ? AND read = 0`).run(
        familyId
      );
    },
  };

  const llmCache = {
    get(key) {
      const row = db
        .prepare(
          `
        SELECT response, model, expires_at, tokens_in, tokens_out, hits
        FROM llm_cache WHERE key = ?
      `
        )
        .get(key);
      if (!row) return null;
      if (new Date(row.expires_at).getTime() <= Date.now()) {
        // Expired — rydd lazy og returner null
        db.prepare('DELETE FROM llm_cache WHERE key = ?').run(key);
        return null;
      }
      // Oppdater hit-stats (fire-and-forget for hot path)
      db.prepare(
        `
        UPDATE llm_cache SET hits = hits + 1, last_hit_at = datetime('now')
        WHERE key = ?
      `
      ).run(key);
      return {
        response: row.response,
        model: row.model,
        tokensIn: row.tokens_in,
        tokensOut: row.tokens_out,
        hits: row.hits + 1,
      };
    },
    set(key, { model, prompt, response, tokensIn = null, tokensOut = null, ttlSeconds = 3600 }) {
      const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
      db.prepare(
        `
        INSERT INTO llm_cache (key, model, prompt, response, tokens_in, tokens_out, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          response = excluded.response,
          tokens_in = excluded.tokens_in,
          tokens_out = excluded.tokens_out,
          expires_at = excluded.expires_at,
          hits = 0,
          last_hit_at = NULL
      `
      ).run(key, model, prompt, response, tokensIn, tokensOut, expiresAt);
    },
    cleanup() {
      const res = db.prepare(`DELETE FROM llm_cache WHERE expires_at <= datetime('now')`).run();
      return res.changes || 0;
    },
    count() {
      return db.prepare('SELECT COUNT(*) as c FROM llm_cache').get().c;
    },
    stats() {
      const total = db
        .prepare('SELECT COUNT(*) as c, COALESCE(SUM(hits),0) as h FROM llm_cache')
        .get();
      return { entries: total.c, totalHits: total.h };
    },
  };

  const llmAudit = {
    log({ toolName, arguments: args, result, success, userMessage }) {
      const familyId = getFamilyId();
      db.prepare(
        `
        INSERT INTO llm_audit (family_id, tool_name, arguments, result, success, user_message)
        VALUES (?, ?, ?, ?, ?, ?)
      `
      ).run(
        familyId,
        toolName,
        args ? JSON.stringify(args) : null,
        result ? JSON.stringify(result).slice(0, 4000) : null,
        success ? 1 : 0,
        userMessage || null
      );
    },
    getRecent(limit = 50) {
      const familyId = getFamilyId();
      return db
        .prepare(`SELECT * FROM llm_audit WHERE family_id = ? ORDER BY timestamp DESC LIMIT ?`)
        .all(familyId, limit);
    },
  };

  const stateSnapshots = {
    insert(type, dataJson) {
      return db
        .prepare(
          `
        INSERT INTO state_snapshots (type, data_json) VALUES (?, ?)
      `
        )
        .run(type, dataJson).lastInsertRowid;
    },
    getLatest(type) {
      const row = db
        .prepare(
          `
        SELECT id, type, data_json as dataJson, created_at as createdAt
        FROM state_snapshots
        WHERE type = ?
        ORDER BY created_at DESC, id DESC
        LIMIT 1
      `
        )
        .get(type);
      return row || null;
    },
    getAllForType(type) {
      return db
        .prepare(
          `
        SELECT id, type, data_json as dataJson, created_at as createdAt
        FROM state_snapshots
        WHERE type = ?
        ORDER BY created_at DESC, id DESC
      `
        )
        .all(type);
    },
    trimToLast(type, keep = 2) {
      const rows = stateSnapshots.getAllForType(type);
      if (rows.length <= keep) return 0;
      const toDelete = rows.slice(keep).map((r) => r.id);
      const del = db.prepare('DELETE FROM state_snapshots WHERE id = ?');
      const tx = db.transaction(() => {
        for (const id of toDelete) del.run(id);
      });
      tx();
      return toDelete.length;
    },
  };

  const familyProfile = {
    get() {
      const familyId = getFamilyId();
      try {
        const r = db.prepare('SELECT * FROM family_profile WHERE family_id = ?').get(familyId);
        if (!r) {
          return {
            members: [],
            allergies: [],
            dislikes: [],
            preferences: {},
            preferredChain: null,
            secondaryChain: null,
          };
        }
        return {
          members: JSON.parse(r.members || '[]'),
          allergies: JSON.parse(r.allergies || '[]'),
          dislikes: JSON.parse(r.dislikes || '[]'),
          preferences: JSON.parse(r.preferences || '{}'),
          preferredChain: r.preferred_chain || null,
          secondaryChain: r.secondary_chain || null,
          updatedAt: r.updated_at,
        };
      } catch {
        // Fallback if the table does not exist yet (very old DB).
        return {
          members: [],
          allergies: [],
          dislikes: [],
          preferences: {},
          preferredChain: null,
          secondaryChain: null,
        };
      }
    },
    update(profile) {
      const familyId = getFamilyId();
      const current = familyProfile.get();
      const merged = {
        members: profile.members ?? current.members,
        allergies: profile.allergies ?? current.allergies,
        dislikes: profile.dislikes ?? current.dislikes,
        preferences: profile.preferences ?? current.preferences,
        preferredChain:
          profile.preferredChain !== undefined ? profile.preferredChain : current.preferredChain,
        secondaryChain:
          profile.secondaryChain !== undefined ? profile.secondaryChain : current.secondaryChain,
      };
      db.prepare(
        `
        INSERT INTO family_profile (id, family_id, members, allergies, dislikes, preferences, preferred_chain, secondary_chain, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(family_id) DO UPDATE SET
          members = excluded.members,
          allergies = excluded.allergies,
          dislikes = excluded.dislikes,
          preferences = excluded.preferences,
          preferred_chain = excluded.preferred_chain,
          secondary_chain = excluded.secondary_chain,
          updated_at = datetime('now')
      `
      ).run(
        familyId,
        familyId,
        JSON.stringify(merged.members),
        JSON.stringify(merged.allergies),
        JSON.stringify(merged.dislikes),
        JSON.stringify(merged.preferences),
        merged.preferredChain || null,
        merged.secondaryChain || null
      );
      return merged;
    },
  };

  const filterUsage = {
    recordUsage(filterId, action) {
      if (!filterId) return;
      const familyId = getFamilyId();
      const isEnable = action === 'enabled' || action === 'enable';
      try {
        if (isEnable) {
          db.prepare(
            `
            INSERT INTO filter_usage (family_id, filter_id, enable_count, last_used_at)
            VALUES (?, ?, 1, datetime('now'))
            ON CONFLICT(family_id, filter_id) DO UPDATE SET
              enable_count = enable_count + 1,
              last_used_at = datetime('now')
          `
          ).run(familyId, filterId);
        } else {
          db.prepare(
            `
            INSERT INTO filter_usage (family_id, filter_id, disable_count, last_used_at)
            VALUES (?, ?, 1, datetime('now'))
            ON CONFLICT(family_id, filter_id) DO UPDATE SET
              disable_count = disable_count + 1,
              last_used_at = datetime('now')
          `
          ).run(familyId, filterId);
        }
      } catch {
        /* robust mot eldre DB */
      }
    },
    getTopN(n = 3) {
      const familyId = getFamilyId();
      try {
        return db
          .prepare(
            `
          SELECT filter_id as filterId, enable_count as enableCount,
                 disable_count as disableCount, last_used_at as lastUsedAt
          FROM filter_usage
          WHERE family_id = ? AND enable_count > 0
          ORDER BY enable_count DESC, last_used_at DESC
          LIMIT ?
        `
          )
          .all(familyId, n);
      } catch {
        return [];
      }
    },
    getAll() {
      const familyId = getFamilyId();
      try {
        return db
          .prepare(
            `
          SELECT filter_id as filterId, enable_count as enableCount,
                 disable_count as disableCount, last_used_at as lastUsedAt
          FROM filter_usage
          WHERE family_id = ?
          ORDER BY enable_count DESC
        `
          )
          .all(familyId);
      } catch {
        return [];
      }
    },
  };

  const auditLog = {
    /**
     * Registrer en audit-hendelse.
     * @param {object} entry
     * @param {string} entry.requestId   - X-Request-Id (uuid)
     * @param {string} [entry.actor]     - brukeridentifikator (default: 'local')
     * @param {string} entry.action      - 'DELETE' | 'PUT' | 'PATCH' | 'POST'
     * @param {string} entry.entityType  - ressurs-type (f.eks. 'recipe')
     * @param {string|number} [entry.entityId]
     * @param {string} entry.route       - full HTTP-path, f.eks. '/api/recipes/42'
     * @param {object} [entry.before]    - object before change (hashes)
     * @param {object} [entry.after]     - objekt etter endring (hashes)
     * @param {object} [entry.metadata]  - extra context (small key/val)
     */
    record(entry) {
      const familyId = getFamilyId();
      const crypto = require('crypto');
      const hash = (obj) => {
        if (obj == null) return null;
        const s = typeof obj === 'string' ? obj : JSON.stringify(obj);
        return 'sha256:' + crypto.createHash('sha256').update(s).digest('hex');
      };
      try {
        db.prepare(
          `
          INSERT INTO audit_log
            (family_id, request_id, actor, action, entity_type, entity_id, route, before_hash, after_hash, metadata)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
        ).run(
          familyId,
          entry.requestId || 'unknown',
          entry.actor || 'local',
          entry.action,
          entry.entityType,
          entry.entityId != null ? String(entry.entityId) : null,
          entry.route,
          hash(entry.before),
          hash(entry.after),
          entry.metadata ? JSON.stringify(entry.metadata).slice(0, 2000) : null
        );
      } catch (err) {
        if (process.env.NODE_ENV !== 'test') {
          console.error('[audit] could not write to audit_log:', err.message);
        }
      }
    },

    getRecent(limit = 100) {
      const familyId = getFamilyId();
      return db
        .prepare(
          `SELECT id, timestamp, request_id as requestId, actor, action,
                  entity_type as entityType, entity_id as entityId, route,
                  before_hash as beforeHash, after_hash as afterHash, metadata
           FROM audit_log WHERE family_id = ?
           ORDER BY timestamp DESC, id DESC LIMIT ?`
        )
        .all(familyId, Math.max(1, Math.min(500, limit)))
        .map((r) => ({ ...r, metadata: r.metadata ? tryParseJson(r.metadata) : null }));
    },

    getByEntity(entityType, entityId = null, limit = 100) {
      const familyId = getFamilyId();
      if (entityId != null) {
        return db
          .prepare(
            `SELECT id, timestamp, request_id as requestId, actor, action,
                    entity_type as entityType, entity_id as entityId, route,
                    before_hash as beforeHash, after_hash as afterHash, metadata
             FROM audit_log
             WHERE family_id = ? AND entity_type = ? AND entity_id = ?
             ORDER BY timestamp DESC, id DESC LIMIT ?`
          )
          .all(familyId, entityType, String(entityId), Math.max(1, Math.min(500, limit)))
          .map((r) => ({ ...r, metadata: r.metadata ? tryParseJson(r.metadata) : null }));
      }
      return db
        .prepare(
          `SELECT id, timestamp, request_id as requestId, actor, action,
                  entity_type as entityType, entity_id as entityId, route,
                  before_hash as beforeHash, after_hash as afterHash, metadata
           FROM audit_log
           WHERE family_id = ? AND entity_type = ?
           ORDER BY timestamp DESC, id DESC LIMIT ?`
        )
        .all(familyId, entityType, Math.max(1, Math.min(500, limit)))
        .map((r) => ({ ...r, metadata: r.metadata ? tryParseJson(r.metadata) : null }));
    },

    stats() {
      const familyId = getFamilyId();
      const total = db
        .prepare('SELECT COUNT(*) as c FROM audit_log WHERE family_id = ?')
        .get(familyId).c;
      const byAction = db
        .prepare('SELECT action, COUNT(*) as c FROM audit_log WHERE family_id = ? GROUP BY action')
        .all(familyId);
      const byEntity = db
        .prepare(
          'SELECT entity_type, COUNT(*) as c FROM audit_log WHERE family_id = ? GROUP BY entity_type ORDER BY c DESC LIMIT 10'
        )
        .all(familyId);
      return { total, byAction, byEntity };
    },
  };

  return {
    kb,
    notifications,
    llmCache,
    llmAudit,
    stateSnapshots,
    familyProfile,
    filterUsage,
    auditLog,
    hasFTS,
  };
}

module.exports = { createSystemRepos };
