CREATE TABLE IF NOT EXISTS abuse_reports (
  id TEXT PRIMARY KEY,
  report_id TEXT REFERENCES reports(id),
  resource_id TEXT REFERENCES resources(id),
  reason TEXT NOT NULL,
  details TEXT,
  requester_contact_private TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_abuse_reports_status ON abuse_reports(status, created_at);
CREATE INDEX IF NOT EXISTS idx_abuse_reports_report ON abuse_reports(report_id);
CREATE INDEX IF NOT EXISTS idx_abuse_reports_resource ON abuse_reports(resource_id);

CREATE TABLE IF NOT EXISTS contact_messages (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL REFERENCES reports(id),
  sender_name TEXT,
  sender_contact_private TEXT,
  body TEXT NOT NULL,
  moderation_status TEXT NOT NULL DEFAULT 'pending_review',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_contact_messages_report ON contact_messages(report_id);
CREATE INDEX IF NOT EXISTS idx_contact_messages_moderation ON contact_messages(moderation_status, created_at);
