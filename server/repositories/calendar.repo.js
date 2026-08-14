'use strict';

const { getFamilyId } = require('../auth/family-context');

const EVENT_SELECT = `
  SELECT id, title, date, start_time as startTime, end_time as endTime,
         location, all_day as allDay, notes, source,
         updated_at as updatedAt, external_id as externalId, etag,
         calendar_external_id as calendarExternalId, rrule, kind,
         hidden, created_by_user_id as createdByUserId
    FROM calendar_events
`;

function toPublicEvent(row, attendees) {
  if (!row) return null;
  return {
    ...row,
    allDay: !!row.allDay,
    hidden: !!row.hidden,
    attendees: attendees || [],
  };
}

function normalizeAttendeeIds(raw) {
  if (!Array.isArray(raw)) return [];
  const ids = [];
  for (const item of raw) {
    const id =
      typeof item === 'number'
        ? item
        : item && typeof item === 'object'
          ? Number(item.memberId ?? item.member_id)
          : Number(item);
    if (Number.isInteger(id) && id > 0) ids.push(id);
  }
  return [...new Set(ids)];
}

function createCalendarRepos(db) {
  const calendar = {
    getAttendees(eventId) {
      const familyId = getFamilyId();
      return db
        .prepare(
          `SELECT member_id as memberId
             FROM calendar_event_attendees
            WHERE family_id = ? AND event_id = ?
            ORDER BY member_id`
        )
        .all(familyId, eventId);
    },

    replaceAttendees(eventId, attendeeIds) {
      const familyId = getFamilyId();
      db.prepare(
        `DELETE FROM calendar_event_attendees WHERE family_id = ? AND event_id = ?`
      ).run(familyId, eventId);
      const ids = normalizeAttendeeIds(attendeeIds);
      if (ids.length === 0) return;
      const insert = db.prepare(
        `INSERT OR IGNORE INTO calendar_event_attendees (event_id, member_id, family_id)
         SELECT ?, id, family_id FROM family_profile_members
          WHERE family_id = ? AND id = ?`
      );
      for (const memberId of ids) {
        insert.run(eventId, familyId, memberId);
      }
    },

    getById(id) {
      const familyId = getFamilyId();
      const row = db.prepare(`${EVENT_SELECT} WHERE family_id = ? AND id = ?`).get(familyId, id);
      if (!row) return null;
      return toPublicEvent(row, calendar.getAttendees(id));
    },

    getEvents(from, to) {
      const familyId = getFamilyId();
      const rows = db
        .prepare(
          `${EVENT_SELECT}
            WHERE family_id = ?
              AND IFNULL(hidden, 0) = 0
              AND (
                (date >= ? AND date <= ?)
                OR (rrule IS NOT NULL AND TRIM(rrule) != '' AND date <= ?)
              )
            ORDER BY date, start_time`
        )
        .all(familyId, from, to, to);
      return rows.map((row) => toPublicEvent(row, calendar.getAttendees(row.id)));
    },

    insert(ev) {
      const familyId = getFamilyId();
      const createdBy =
        Number.isInteger(ev.createdByUserId) && ev.createdByUserId > 0 ? ev.createdByUserId : null;
      const res = db
        .prepare(
          `INSERT INTO calendar_events (
             family_id, title, date, start_time, end_time, location, all_day, notes,
             source, updated_at, external_id, etag, calendar_external_id, rrule, kind,
             hidden, created_by_user_id
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          familyId,
          ev.title,
          ev.date,
          ev.startTime ?? null,
          ev.endTime ?? null,
          ev.location ?? null,
          ev.allDay ? 1 : 0,
          ev.notes ?? null,
          ev.source ?? 'local',
          ev.externalId ?? ev.external_id ?? null,
          ev.etag ?? null,
          ev.calendarExternalId ?? ev.calendar_external_id ?? null,
          ev.rrule ?? null,
          ev.kind ?? null,
          ev.hidden ? 1 : 0,
          createdBy
        );
      const id = Number(res.lastInsertRowid);
      if (ev.attendees) calendar.replaceAttendees(id, ev.attendees);
      return calendar.getById(id);
    },

    update(id, patch) {
      const familyId = getFamilyId();
      const existing = db
        .prepare('SELECT id FROM calendar_events WHERE family_id = ? AND id = ?')
        .get(familyId, id);
      if (!existing) return null;

      const sets = [];
      const params = [];
      const map = {
        title: 'title',
        date: 'date',
        startTime: 'start_time',
        endTime: 'end_time',
        location: 'location',
        notes: 'notes',
        source: 'source',
        externalId: 'external_id',
        etag: 'etag',
        calendarExternalId: 'calendar_external_id',
        rrule: 'rrule',
        kind: 'kind',
      };
      for (const [key, column] of Object.entries(map)) {
        if (Object.prototype.hasOwnProperty.call(patch, key)) {
          sets.push(`${column} = ?`);
          params.push(patch[key] ?? null);
        }
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'allDay')) {
        sets.push('all_day = ?');
        params.push(patch.allDay ? 1 : 0);
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'hidden')) {
        sets.push('hidden = ?');
        params.push(patch.hidden ? 1 : 0);
      }
      sets.push(`updated_at = datetime('now')`);
      params.push(familyId, id);
      db.prepare(
        `UPDATE calendar_events SET ${sets.join(', ')} WHERE family_id = ? AND id = ?`
      ).run(...params);

      if (Object.prototype.hasOwnProperty.call(patch, 'attendees')) {
        calendar.replaceAttendees(id, patch.attendees);
      }
      return calendar.getById(id);
    },

    delete(id) {
      const familyId = getFamilyId();
      const res = db
        .prepare('DELETE FROM calendar_events WHERE family_id = ? AND id = ?')
        .run(familyId, id);
      return res.changes || 0;
    },

    upsertExternal(ev) {
      const familyId = getFamilyId();
      const source = ev.source;
      const externalId = ev.externalId ?? ev.external_id;
      if (!source || !externalId) {
        throw new Error('upsertExternal requires source and externalId');
      }
      const existing = db
        .prepare(
          `SELECT id FROM calendar_events
            WHERE family_id = ? AND source = ? AND external_id = ?`
        )
        .get(familyId, source, externalId);
      const payload = {
        title: ev.title,
        date: ev.date,
        startTime: ev.startTime ?? null,
        endTime: ev.endTime ?? null,
        location: ev.location ?? null,
        allDay: ev.allDay ? 1 : 0,
        notes: ev.notes ?? null,
        etag: ev.etag ?? null,
        calendarExternalId: ev.calendarExternalId ?? ev.calendar_external_id ?? null,
        rrule: ev.rrule ?? null,
        kind: ev.kind ?? null,
        hidden: ev.hidden ? 1 : 0,
      };
      if (existing) {
        db.prepare(
          `UPDATE calendar_events
              SET title = ?, date = ?, start_time = ?, end_time = ?, location = ?,
                  all_day = ?, notes = ?, etag = ?, calendar_external_id = ?,
                  rrule = ?, kind = ?, hidden = ?, updated_at = datetime('now')
            WHERE family_id = ? AND id = ?`
        ).run(
          payload.title,
          payload.date,
          payload.startTime,
          payload.endTime,
          payload.location,
          payload.allDay,
          payload.notes,
          payload.etag,
          payload.calendarExternalId,
          payload.rrule,
          payload.kind,
          payload.hidden,
          familyId,
          existing.id
        );
        return calendar.getById(existing.id);
      }
      return calendar.insert({
        ...ev,
        source,
        externalId,
      });
    },
  };

  function publicIntegration(row) {
    if (!row) return null;
    return {
      id: row.id,
      provider: row.provider,
      accountEmail: row.account_email,
      calendarDisplayName: row.calendar_display_name,
      calendarExternalId: row.calendar_external_id,
      writeEnabled: !!row.write_enabled,
      lastSyncedAt: row.last_synced_at,
      lastError: row.last_error,
    };
  }

  const calendarIntegrations = {
    listPublic() {
      const familyId = getFamilyId();
      return db
        .prepare(
          `SELECT id, provider, account_email, calendar_display_name, calendar_external_id,
                  write_enabled, last_synced_at, last_error
             FROM calendar_integrations
            WHERE family_id = ?
            ORDER BY created_at, id`
        )
        .all(familyId)
        .map((row) => ({
          id: row.id,
          provider: row.provider,
          accountEmail: row.account_email,
          calendarDisplayName: row.calendar_display_name,
          calendarExternalId: row.calendar_external_id,
          writeEnabled: !!row.write_enabled,
          lastSyncedAt: row.last_synced_at,
          lastError: row.last_error,
        }));
    },

    listRaw() {
      const familyId = getFamilyId();
      return db
        .prepare(`SELECT * FROM calendar_integrations WHERE family_id = ? ORDER BY id`)
        .all(familyId);
    },

    getById(id) {
      const familyId = getFamilyId();
      return (
        db
          .prepare(`SELECT * FROM calendar_integrations WHERE family_id = ? AND id = ?`)
          .get(familyId, id) || null
      );
    },

    getByIdPublic(id) {
      return publicIntegration(calendarIntegrations.getById(id));
    },

    upsertIcloud({ userId, email, appPasswordEnc, calendarExternalId }) {
      const familyId = getFamilyId();
      db.prepare(
        `INSERT INTO calendar_integrations (
           family_id, user_id, provider, account_email, calendar_external_id,
           app_password_enc, write_enabled
         ) VALUES (?, ?, 'icloud', ?, ?, ?, 1)
         ON CONFLICT(family_id, provider, account_email) DO UPDATE SET
           user_id = excluded.user_id,
           calendar_external_id = COALESCE(excluded.calendar_external_id, calendar_external_id),
           app_password_enc = excluded.app_password_enc,
           last_error = NULL`
      ).run(familyId, userId, email, calendarExternalId ?? null, appPasswordEnc);
      const row = db
        .prepare(
          `SELECT * FROM calendar_integrations
            WHERE family_id = ? AND provider = 'icloud' AND account_email = ?`
        )
        .get(familyId, email);
      return publicIntegration(row);
    },

    upsertGoogle({
      userId,
      email,
      refreshTokenEnc,
      accessTokenEnc,
      accessTokenExpiresAt,
      calendarExternalId,
      calendarDisplayName,
    }) {
      const familyId = getFamilyId();
      db.prepare(
        `INSERT INTO calendar_integrations (
           family_id, user_id, provider, account_email, calendar_external_id,
           calendar_display_name, refresh_token_enc, access_token_enc,
           access_token_expires_at, write_enabled
         ) VALUES (?, ?, 'google', ?, ?, ?, ?, ?, ?, 1)
         ON CONFLICT(family_id, provider, account_email) DO UPDATE SET
           user_id = excluded.user_id,
           calendar_external_id = COALESCE(excluded.calendar_external_id, calendar_external_id),
           calendar_display_name = COALESCE(excluded.calendar_display_name, calendar_display_name),
           refresh_token_enc = excluded.refresh_token_enc,
           access_token_enc = excluded.access_token_enc,
           access_token_expires_at = excluded.access_token_expires_at,
           last_error = NULL`
      ).run(
        familyId,
        userId,
        email,
        calendarExternalId ?? null,
        calendarDisplayName ?? null,
        refreshTokenEnc,
        accessTokenEnc ?? null,
        accessTokenExpiresAt ?? null
      );
      const row = db
        .prepare(
          `SELECT * FROM calendar_integrations
            WHERE family_id = ? AND provider = 'google' AND account_email = ?`
        )
        .get(familyId, email);
      return publicIntegration(row);
    },

    updateTokens(id, { accessTokenEnc, accessTokenExpiresAt, refreshTokenEnc }) {
      const familyId = getFamilyId();
      const sets = ['access_token_enc = ?', 'access_token_expires_at = ?'];
      const params = [accessTokenEnc ?? null, accessTokenExpiresAt ?? null];
      if (refreshTokenEnc) {
        sets.push('refresh_token_enc = ?');
        params.push(refreshTokenEnc);
      }
      params.push(familyId, id);
      db.prepare(
        `UPDATE calendar_integrations SET ${sets.join(', ')} WHERE family_id = ? AND id = ?`
      ).run(...params);
    },

    markSynced(id, { error = null } = {}) {
      const familyId = getFamilyId();
      db.prepare(
        `UPDATE calendar_integrations
            SET last_synced_at = datetime('now'), last_error = ?
          WHERE family_id = ? AND id = ?`
      ).run(error ?? null, familyId, id);
    },

    delete(id) {
      const familyId = getFamilyId();
      db.prepare(
        `UPDATE calendar_integrations
            SET refresh_token_enc = NULL,
                app_password_enc = NULL,
                access_token_enc = NULL,
                sync_token = NULL
          WHERE family_id = ? AND id = ?`
      ).run(familyId, id);
      const res = db
        .prepare(`DELETE FROM calendar_integrations WHERE family_id = ? AND id = ?`)
        .run(familyId, id);
      return res.changes || 0;
    },
  };

  return { calendar, calendarIntegrations };
}

module.exports = { createCalendarRepos };
