ALTER TABLE resources ADD COLUMN accepted_groups TEXT;
ALTER TABLE resources ADD COLUMN accessibility TEXT;
ALTER TABLE resources ADD COLUMN supplies TEXT;
ALTER TABLE resources ADD COLUMN current_needs TEXT;
ALTER TABLE resources ADD COLUMN services TEXT;
ALTER TABLE resources ADD COLUMN verification_due_at TEXT;

ALTER TABLE organizations ADD COLUMN verification_evidence TEXT;
ALTER TABLE organizations ADD COLUMN onboarding_status TEXT NOT NULL DEFAULT 'approved';

ALTER TABLE moderation_items ADD COLUMN lane TEXT NOT NULL DEFAULT 'general';
ALTER TABLE moderation_items ADD COLUMN priority INTEGER NOT NULL DEFAULT 0;
ALTER TABLE moderation_items ADD COLUMN reviewer_note TEXT;
ALTER TABLE moderation_items ADD COLUMN requested_info TEXT;

CREATE TABLE IF NOT EXISTS report_manage_tokens (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL REFERENCES reports(id),
  token_hash TEXT NOT NULL UNIQUE,
  contact_hint TEXT,
  expires_at TEXT,
  used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_report_manage_tokens_report ON report_manage_tokens(report_id);

CREATE TABLE IF NOT EXISTS organization_applications (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  description TEXT,
  website TEXT,
  contact_public TEXT,
  contact_private TEXT,
  verification_evidence TEXT,
  status TEXT NOT NULL DEFAULT 'pending_review',
  created_organization_id TEXT REFERENCES organizations(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_org_applications_status ON organization_applications(status, created_at);

CREATE TABLE IF NOT EXISTS map_layers (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  label TEXT NOT NULL,
  description TEXT,
  geometry_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  visibility TEXT NOT NULL DEFAULT 'public',
  verification_level TEXT NOT NULL DEFAULT 'unverified',
  organization_id TEXT REFERENCES organizations(id),
  source_url TEXT,
  updated_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_map_layers_type ON map_layers(type, status);
CREATE INDEX IF NOT EXISTS idx_map_layers_visibility ON map_layers(visibility, status);

CREATE TABLE IF NOT EXISTS resource_translations (
  id TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL REFERENCES resources(id),
  locale TEXT NOT NULL,
  name TEXT,
  description TEXT,
  services TEXT,
  current_needs TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE(resource_id, locale)
);

CREATE TABLE IF NOT EXISTS locale_overrides (
  id TEXT PRIMARY KEY,
  locale TEXT NOT NULL,
  namespace TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(locale, namespace, key)
);

CREATE TABLE IF NOT EXISTS volunteer_assignments (
  id TEXT PRIMARY KEY,
  volunteer_id TEXT NOT NULL REFERENCES volunteers(id),
  organization_id TEXT REFERENCES organizations(id),
  task_label TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'assigned',
  notes_private TEXT,
  created_by_user_id TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_volunteer_assignments_volunteer ON volunteer_assignments(volunteer_id, status);
