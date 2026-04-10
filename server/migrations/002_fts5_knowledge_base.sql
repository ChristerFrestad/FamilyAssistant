-- Migration 002: FTS5 fulltekstsøk for knowledge_base
-- Erstatter LIKE '%q%' i kbSearch med ekte BM25-rangert søk.
-- Ved skriving til knowledge_base holder triggeren FTS-tabellen synkronisert.

CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_base_fts USING fts5(
  user_message,
  ai_response,
  intent,
  content='knowledge_base',
  content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);

-- Triggere: hold FTS-indeksen synkronisert med kilde-tabellen
CREATE TRIGGER IF NOT EXISTS kb_ai AFTER INSERT ON knowledge_base BEGIN
  INSERT INTO knowledge_base_fts(rowid, user_message, ai_response, intent)
  VALUES (new.id, new.user_message, new.ai_response, new.intent);
END;

CREATE TRIGGER IF NOT EXISTS kb_ad AFTER DELETE ON knowledge_base BEGIN
  INSERT INTO knowledge_base_fts(knowledge_base_fts, rowid, user_message, ai_response, intent)
  VALUES ('delete', old.id, old.user_message, old.ai_response, old.intent);
END;

CREATE TRIGGER IF NOT EXISTS kb_au AFTER UPDATE ON knowledge_base BEGIN
  INSERT INTO knowledge_base_fts(knowledge_base_fts, rowid, user_message, ai_response, intent)
  VALUES ('delete', old.id, old.user_message, old.ai_response, old.intent);
  INSERT INTO knowledge_base_fts(rowid, user_message, ai_response, intent)
  VALUES (new.id, new.user_message, new.ai_response, new.intent);
END;
