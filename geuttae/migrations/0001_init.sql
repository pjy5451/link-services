-- 그때열기 D1 스키마
CREATE TABLE IF NOT EXISTS capsules(
  id TEXT PRIMARY KEY,
  owner_hash TEXT NOT NULL,
  sender TEXT,
  teaser TEXT,              -- 잠겨 있는 동안 보이는 문구
  message TEXT NOT NULL,    -- 열린 뒤 보이는 본문
  file_key TEXT,            -- R2 사진(선택)
  open_at INTEGER NOT NULL,
  close_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cap_close ON capsules(close_at);
CREATE TABLE IF NOT EXISTS reports(
  id INTEGER PRIMARY KEY AUTOINCREMENT, target TEXT NOT NULL, reason TEXT NOT NULL, detail TEXT,
  created_at INTEGER NOT NULL, ip_hash TEXT, handled INTEGER NOT NULL DEFAULT 0
);
