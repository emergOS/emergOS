ALTER TABLE reports ADD COLUMN duplicate_of_report_id TEXT REFERENCES reports(id);
ALTER TABLE reports ADD COLUMN archived_at TEXT;

CREATE TABLE IF NOT EXISTS report_redirects (
  old_slug TEXT PRIMARY KEY,
  new_slug TEXT NOT NULL,
  report_id TEXT NOT NULL REFERENCES reports(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS duplicate_candidates (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL REFERENCES reports(id),
  candidate_report_id TEXT NOT NULL REFERENCES reports(id),
  score INTEGER NOT NULL,
  reasons_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(report_id, candidate_report_id)
);

CREATE INDEX IF NOT EXISTS idx_duplicate_candidates_status ON duplicate_candidates(status, score DESC);
CREATE INDEX IF NOT EXISTS idx_duplicate_candidates_report ON duplicate_candidates(report_id);

CREATE TABLE IF NOT EXISTS generated_files (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  bucket_key TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER,
  created_by_user_id TEXT REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS import_jobs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  source_filename TEXT,
  bucket_key TEXT,
  total_rows INTEGER NOT NULL DEFAULT 0,
  processed_rows INTEGER NOT NULL DEFAULT 0,
  error_rows INTEGER NOT NULL DEFAULT 0,
  error_json TEXT NOT NULL DEFAULT '[]',
  created_by_user_id TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_import_jobs_status ON import_jobs(status, created_at);

CREATE TABLE IF NOT EXISTS export_jobs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  bucket_key TEXT,
  row_count INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_by_user_id TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_export_jobs_status ON export_jobs(status, created_at);

CREATE TABLE IF NOT EXISTS organization_memberships (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL DEFAULT 'organization_manager',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(organization_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_org_memberships_user ON organization_memberships(user_id);

CREATE TABLE IF NOT EXISTS volunteers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  contact_private TEXT NOT NULL,
  location TEXT,
  skills TEXT,
  languages TEXT,
  availability TEXT,
  transport_access TEXT,
  credentials_private TEXT,
  consent_share_with_orgs_at TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  assigned_organization_id TEXT REFERENCES organizations(id),
  notes_private TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_volunteers_status ON volunteers(status, created_at);
CREATE INDEX IF NOT EXISTS idx_volunteers_org ON volunteers(assigned_organization_id);

CREATE TABLE IF NOT EXISTS data_requests (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  report_id TEXT REFERENCES reports(id),
  requester_contact_private TEXT,
  details TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  result_bucket_key TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_data_requests_status ON data_requests(status, created_at);

CREATE TABLE IF NOT EXISTS retention_policies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  tips_days_after_closure INTEGER NOT NULL DEFAULT 90,
  audit_log_days INTEGER NOT NULL DEFAULT 365,
  volunteer_days_after_crisis INTEGER NOT NULL DEFAULT 30,
  enabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO retention_policies (
  id, name, tips_days_after_closure, audit_log_days, volunteer_days_after_crisis, enabled, created_at, updated_at
) VALUES (
  'default-retention-policy', 'Default crisis retention', 90, 365, 30, 0, datetime('now'), datetime('now')
);
