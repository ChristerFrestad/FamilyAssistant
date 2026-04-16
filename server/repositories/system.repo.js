'use strict';

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
      return db
        .prepare(
          `
        INSERT INTO knowledge_base (timestamp, user_message, ai_response, context_json, intent, entities_json)
        VALUES (?, ?, ?, ?, ?, ?)
      `
        )
        .run(
          entry.timestamp || new Date().toISOString(),
          entry.userMessage,
          entry.aiResponse,
          entry.context ? JSON.stringify(entry.context) : null,
          entry.intent || null,
          entry.entities ? JSON.stringify(entry.entities) : null
        ).lastInsertRowid;
    },
    search(query, limit = 10) {
      if (hasFTS && query && query.trim()) {
        // FTS5 BM25-søk
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
            WHERE knowledge_base_fts MATCH ?
            ORDER BY bm25(knowledge_base_fts) LIMIT ?
          `
            )
            .all(safe, limit);
        } catch {
          /* falle tilbake til LIKE */
        }
      }
      const like = `%${query}%`;
      return db
        .prepare(
          `
        SELECT * FROM knowledge_base
        WHERE user_message LIKE ? OR ai_response LIKE ?
        ORDER BY timestamp DESC LIMIT ?
      `
        )
        .all(like, like, limit);
    },
    getRecent(limit = 20) {
      return db.prepare('SELECT * FROM knowledge_base ORDER BY timestamp DESC LIMIT ?').all(limit);
    },
    count() {
      return db.prepare('SELECT COUNT(*) as c FROM knowledge_base').get().c;
    },
  };

  const calendar = {
    getEvents(from, to) {
      return db
        .prepare(
          `
        SELECT id, title, date, start_time as startTime, end_time as endTime, location, all_day as allDay, notes, source
        FROM calendar_events WHERE date >= ? AND date <= ? ORDER BY date, start_time
      `
        )
        .all(from, to);
    },
    insert(ev) {
      const res = db
        .prepare(
          `
        INSERT INTO calendar_events (title, date, start_time, end_time, location, all_day, notes, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `
        )
        .run(
          ev.title,
          ev.date,
          ev.startTime ?? null,
          ev.endTime ?? null,
          ev.location ?? null,
          ev.allDay ? 1 : 0,
          ev.notes ?? null,
          ev.source ?? 'local'
        );
      return { id: res.lastInsertRowid, ...ev };
    },
    delete(id) {
      db.prepare('DELETE FROM calendar_events WHERE id = ?').run(id);
    },
  };

  const notifications = {
    insert(type, message, data = null) {
      db.prepare(
        `
        INSERT INTO notifications (type, message, data_json) VALUES (?, ?, ?)
      `
      ).run(type, message, data ? JSON.stringify(data) : null);
    },
    getUnread() {
      return db
        .prepare(`SELECT * FROM notifications WHERE read = 0 ORDER BY created_at DESC`)
        .all();
    },
    markAllRead() {
      db.prepare(`UPDATE notifications SET read = 1 WHERE read = 0`).run();
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
      db.prepare(
        `
        INSERT INTO llm_audit (tool_name, arguments, result, success, user_message)
        VALUES (?, ?, ?, ?, ?)
      `
      ).run(
        toolName,
        args ? JSON.stringify(args) : null,
        result ? JSON.stringify(result).slice(0, 4000) : null,
        success ? 1 : 0,
        userMessage || null
      );
    },
    getRecent(limit = 50) {
      return db.prepare(`SELECT * FROM llm_audit ORDER BY timestamp DESC LIMIT ?`).all(limit);
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
      try {
        const r = db.prepare('SELECT * FROM family_profile WHERE id = 1').get();
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
        // Fallback hvis tabellen ikke finnes (eldre DB)
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
        INSERT INTO family_profile (id, members, allergies, dislikes, preferences, preferred_chain, secondary_chain, updated_at)
        VALUES (1, ?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(id) DO UPDATE SET
          members = excluded.members,
          allergies = excluded.allergies,
          dislikes = excluded.dislikes,
          preferences = excluded.preferences,
          preferred_chain = excluded.preferred_chain,
          secondary_chain = excluded.secondary_chain,
          updated_at = datetime('now')
      `
      ).run(
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
      const isEnable = action === 'enabled' || action === 'enable';
      try {
        // Bruk separate prepared statements i stedet for template literal
        // for å unngå SQL-injeksjonsrisiko via kolonne-interpolering.
        if (isEnable) {
          db.prepare(
            `
            INSERT INTO filter_usage (filter_id, enable_count, last_used_at)
            VALUES (?, 1, datetime('now'))
            ON CONFLICT(filter_id) DO UPDATE SET
              enable_count = enable_count + 1,
              last_used_at = datetime('now')
          `
          ).run(filterId);
        } else {
          db.prepare(
            `
            INSERT INTO filter_usage (filter_id, disable_count, last_used_at)
            VALUES (?, 1, datetime('now'))
            ON CONFLICT(filter_id) DO UPDATE SET
              disable_count = disable_count + 1,
              last_used_at = datetime('now')
          `
          ).run(filterId);
        }
      } catch {
        /* robust mot eldre DB */
      }
    },
    getTopN(n = 3) {
      try {
        return db
          .prepare(
            `
          SELECT filter_id as filterId, enable_count as enableCount,
                 disable_count as disableCount, last_used_at as lastUsedAt
          FROM filter_usage
          WHERE enable_count > 0
          ORDER BY enable_count DESC, last_used_at DESC
          LIMIT ?
        `
          )
          .all(n);
      } catch {
        return [];
      }
    },
    getAll() {
      try {
        return db
          .prepare(
            `
          SELECT filter_id as filterId, enable_count as enableCount,
                 disable_count as disableCount, last_used_at as lastUsedAt
          FROM filter_usage
          ORDER BY enable_count DESC
        `
          )
          .all();
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
     * @param {object} [entry.before]    - objekt før endring (hashes)
     * @param {object} [entry.after]     - objekt etter endring (hashes)
     * @param {object} [entry.metadata]  - ekstra context (små key-val)
     */
    record(entry) {
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
            (request_id, actor, action, entity_type, entity_id, route, before_hash, after_hash, metadata)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
        ).run(
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
        // Audit-feil skal aldri tørke ut hovedoperasjonen. Logg stille.
        if (process.env.NODE_ENV !== 'test') {
          console.error('[audit] kunne ikke skrive til audit_log:', err.message);
        }
      }
    },

    /** Hent siste N hendelser (DESC på timestamp).
     *  Uke 5 PERF-3: ORDER BY timestamp DESC, id DESC bruker
     *  idx_audit_log_timestamp i stedet for full SCAN. */
    getRecent(limit = 100) {
      return db
        .prepare(
          `SELECT id, timestamp, request_id as requestId, actor, action,
                  entity_type as entityType, entity_id as entityId, route,
                  before_hash as beforeHash, after_hash as afterHash, metadata
           FROM audit_log ORDER BY timestamp DESC, id DESC LIMIT ?`
        )
        .all(Math.max(1, Math.min(500, limit)))
        .map((r) => ({ ...r, metadata: r.metadata ? tryParseJson(r.metadata) : null }));
    },

    /** Filtrer på entity_type + (optional) entity_id.
     *  Uke 5 PERF-3: ORDER BY timestamp DESC bruker index. */
    getByEntity(entityType, entityId = null, limit = 100) {
      if (entityId != null) {
        return db
          .prepare(
            `SELECT id, timestamp, request_id as requestId, actor, action,
                    entity_type as entityType, entity_id as entityId, route,
                    before_hash as beforeHash, after_hash as afterHash, metadata
             FROM audit_log
             WHERE entity_type = ? AND entity_id = ?
             ORDER BY timestamp DESC, id DESC LIMIT ?`
          )
          .all(entityType, String(entityId), Math.max(1, Math.min(500, limit)))
          .map((r) => ({ ...r, metadata: r.metadata ? tryParseJson(r.metadata) : null }));
      }
      return db
        .prepare(
          `SELECT id, timestamp, request_id as requestId, actor, action,
                  entity_type as entityType, entity_id as entityId, route,
                  before_hash as beforeHash, after_hash as afterHash, metadata
           FROM audit_log
           WHERE entity_type = ?
           ORDER BY timestamp DESC, id DESC LIMIT ?`
        )
        .all(entityType, Math.max(1, Math.min(500, limit)))
        .map((r) => ({ ...r, metadata: r.metadata ? tryParseJson(r.metadata) : null }));
    },

    /** Statistikk for /api/audit/stats — brukes av dashboards. */
    stats() {
      const total = db.prepare('SELECT COUNT(*) as c FROM audit_log').get().c;
      const byAction = db
        .prepare('SELECT action, COUNT(*) as c FROM audit_log GROUP BY action')
        .all();
      const byEntity = db
        .prepare(
          'SELECT entity_type, COUNT(*) as c FROM audit_log GROUP BY entity_type ORDER BY c DESC LIMIT 10'
        )
        .all();
      return { total, byAction, byEntity };
    },
  };

  return {
    kb,
    calendar,
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
