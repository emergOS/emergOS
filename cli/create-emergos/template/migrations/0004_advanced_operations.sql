ALTER TABLE reports ADD COLUMN assigned_organization_id TEXT REFERENCES organizations(id);
ALTER TABLE contact_messages ADD COLUMN assigned_organization_id TEXT REFERENCES organizations(id);
ALTER TABLE generated_files ADD COLUMN status TEXT NOT NULL DEFAULT 'complete';
ALTER TABLE generated_files ADD COLUMN label TEXT;

CREATE INDEX IF NOT EXISTS idx_reports_assigned_org ON reports(assigned_organization_id);
CREATE INDEX IF NOT EXISTS idx_contact_messages_assigned_org ON contact_messages(assigned_organization_id);
CREATE INDEX IF NOT EXISTS idx_generated_files_type ON generated_files(type, created_at);

CREATE TABLE IF NOT EXISTS inbound_emails (
  id TEXT PRIMARY KEY,
  from_email TEXT,
  to_email TEXT,
  subject TEXT,
  body_text TEXT NOT NULL,
  related_report_id TEXT REFERENCES reports(id),
  created_tip_id TEXT REFERENCES tips(id),
  status TEXT NOT NULL DEFAULT 'pending_review',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_inbound_emails_status ON inbound_emails(status, created_at);

CREATE TABLE IF NOT EXISTS runtime_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO runtime_settings (key, value_json, updated_at)
VALUES ('crisis_mode', '{"enabled":false,"disableMaps":false,"preferLists":false,"imageLight":false}', datetime('now'));
