ALTER TABLE deployments ADD COLUMN safety_policy_json TEXT NOT NULL DEFAULT '{}';

ALTER TABLE pets ADD COLUMN medical_notes_private TEXT;

ALTER TABLE media_assets ADD COLUMN reviewed_by_user_id TEXT;
ALTER TABLE media_assets ADD COLUMN reviewed_at TEXT;
ALTER TABLE media_assets ADD COLUMN review_note TEXT;
ALTER TABLE media_assets ADD COLUMN risk_flags_json TEXT NOT NULL DEFAULT '[]';

ALTER TABLE resources ADD COLUMN donation_url TEXT;
ALTER TABLE resources ADD COLUMN donation_verification_status TEXT NOT NULL DEFAULT 'none';
ALTER TABLE resources ADD COLUMN donation_verified_at TEXT;
ALTER TABLE resources ADD COLUMN protected_location INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS report_change_requests (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL REFERENCES reports(id),
  requested_by_token_id TEXT REFERENCES report_manage_tokens(id),
  change_type TEXT NOT NULL,
  old_json TEXT NOT NULL DEFAULT '{}',
  new_json TEXT NOT NULL DEFAULT '{}',
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending_review',
  reviewer_note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_report_change_requests_report ON report_change_requests(report_id);
CREATE INDEX IF NOT EXISTS idx_report_change_requests_status ON report_change_requests(status);

CREATE TABLE IF NOT EXISTS partner_api_clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  scopes_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active',
  last_used_at TEXT,
  created_by_user_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_partner_api_clients_status ON partner_api_clients(status);
