-- 방도장 D1 스키마
CREATE TABLE IF NOT EXISTS records(
  id TEXT PRIMARY KEY,
  owner_hash TEXT NOT NULL,
  title TEXT NOT NULL,
  note TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS record_photos(
  id TEXT PRIMARY KEY,
  record_id TEXT NOT NULL,
  stage TEXT NOT NULL,          -- in(입주) / out(퇴실)
  room TEXT NOT NULL,
  orig_key TEXT NOT NULL,       -- R2: 원본(EXIF 보존, 작성자만 다운로드)
  disp_key TEXT,                -- R2: 화면용(메타데이터 제거본)
  sha256 TEXT NOT NULL,         -- 원본 SHA-256 (R2가 저장 시 검증)
  size INTEGER NOT NULL,
  received_at INTEGER NOT NULL, -- 서버 수신 시각
  taken_at TEXT,                -- EXIF 촬영 시각(참고용, 위조 가능)
  orig_name TEXT
);
CREATE INDEX IF NOT EXISTS idx_rp_record ON record_photos(record_id, stage);
CREATE TABLE IF NOT EXISTS record_acks(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  manifest TEXT NOT NULL,       -- 확인 당시 사진 묶음 지문
  photo_ids TEXT NOT NULL,      -- 확인 당시 사진 ID 목록(쉼표 구분)
  photo_count INTEGER NOT NULL,
  acked_at INTEGER NOT NULL,
  ip_hash TEXT
);
CREATE INDEX IF NOT EXISTS idx_ra_record ON record_acks(record_id, stage);
CREATE TABLE IF NOT EXISTS reports(
  id INTEGER PRIMARY KEY AUTOINCREMENT, target TEXT NOT NULL, reason TEXT NOT NULL, detail TEXT,
  created_at INTEGER NOT NULL, ip_hash TEXT, handled INTEGER NOT NULL DEFAULT 0
);
