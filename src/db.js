const { createClient } = require('@libsql/client');

// Turso (libSQL) 클라이언트. .env 또는 Render 환경변수에서 읽음.
let url = (process.env.TURSO_URL || '').trim();
let authToken = (process.env.TURSO_TOKEN || '').trim();

// URL 은 libsql:// (또는 http/ws) 로 시작. 두 값이 뒤바뀌어 입력된 경우 자동 보정.
const looksLikeUrl = (s) => /^(libsql|wss?|https?):\/\//i.test(s);
if (!looksLikeUrl(url) && looksLikeUrl(authToken)) {
  console.warn('[db] TURSO_URL/TURSO_TOKEN 값이 뒤바뀐 것으로 보여 자동 교정합니다.');
  [url, authToken] = [authToken, url];
}
if (!looksLikeUrl(url)) {
  throw new Error(
    `TURSO_URL 이 올바른 libsql:// URL 이 아닙니다. 현재 값 시작: "${url.slice(0, 12)}...". ` +
    'Render 대시보드 Environment 에서 TURSO_URL 에 libsql://... 주소를, TURSO_TOKEN 에 토큰을 넣으세요.'
  );
}

const client = createClient({ url, authToken });

// 앱 시작 시 테이블이 없으면 생성 (SQLite 문법)
async function init() {
  await client.executeMultiple(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      email         TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    );

    CREATE TABLE IF NOT EXISTS notebooks (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL,
      name       TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    );

    CREATE TABLE IF NOT EXISTS notes (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL,
      notebook_id INTEGER,
      title       TEXT NOT NULL DEFAULT '',
      content     TEXT NOT NULL DEFAULT '',
      created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    );

    CREATE TABLE IF NOT EXISTS tags (
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name    TEXT NOT NULL,
      UNIQUE (user_id, name)
    );

    CREATE TABLE IF NOT EXISTS note_tags (
      note_id INTEGER NOT NULL,
      tag_id  INTEGER NOT NULL,
      PRIMARY KEY (note_id, tag_id)
    );

    CREATE TABLE IF NOT EXISTS sessions (
      sid    TEXT PRIMARY KEY,
      sess   TEXT NOT NULL,
      expire INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_notes_user ON notes(user_id);
    CREATE INDEX IF NOT EXISTS idx_notes_notebook ON notes(notebook_id);
  `);
  console.log('[db] Turso(libSQL) schema ready');
}

// pg 와 비슷한 사용감을 위한 헬퍼: query(sql, args) -> { rows }
async function query(sql, args = []) {
  const res = await client.execute({ sql, args });
  return res;
}

module.exports = { client, query, init };
