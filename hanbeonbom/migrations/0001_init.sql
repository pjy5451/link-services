-- 한번봄 D1 스키마
CREATE TABLE IF NOT EXISTS views(
  id TEXT PRIMARY KEY,
  owner_hash TEXT NOT NULL,
  file_key TEXT,                 -- R2 키(소진·회수·만료 시 NULL)
  mime TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  max_views INTEGER,             -- NULL = 무제한
  view_count INTEGER NOT NULL DEFAULT 0,
  pw_hash TEXT,
  pw_fails INTEGER NOT NULL DEFAULT 0,
  wm_ip INTEGER NOT NULL DEFAULT 1,
  wm_text TEXT,
  revoked INTEGER NOT NULL DEFAULT 0,
  last_viewed_at INTEGER
);
CREATE TABLE IF NOT EXISTS view_events(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  view_id TEXT NOT NULL,
  at INTEGER NOT NULL,
  ip_masked TEXT,
  ua TEXT
);
CREATE INDEX IF NOT EXISTS idx_ve_view ON view_events(view_id);
CREATE TABLE IF NOT EXISTS tokens(
  token TEXT PRIMARY KEY,         -- 열람 1회분 이미지 접근권(짧은 수명)
  view_id TEXT NOT NULL,
  ip TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS reports(
  id INTEGER PRIMARY KEY AUTOINCREMENT, target TEXT NOT NULL, reason TEXT NOT NULL, detail TEXT,
  created_at INTEGER NOT NULL, ip_hash TEXT, handled INTEGER NOT NULL DEFAULT 0
);
