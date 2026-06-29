CREATE TABLE IF NOT EXISTS deployments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  country_code TEXT NOT NULL,
  default_locale TEXT NOT NULL,
  profile TEXT NOT NULL,
  brand_config_json TEXT NOT NULL DEFAULT '{}',
  module_config_json TEXT NOT NULL DEFAULT '{}',
  contact_config_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS people (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  age INTEGER,
  age_range TEXT,
  gender TEXT,
  description TEXT,
  medical_notes_private TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pets (
  id TEXT PRIMARY KEY,
  name TEXT,
  species TEXT,
  breed TEXT,
  color TEXT,
  markings TEXT,
  microchip_private TEXT,
  notes_public TEXT,
  notes_private TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS media_assets (
  id TEXT PRIMARY KEY,
  bucket_key TEXT NOT NULL,
  type TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  alt_text TEXT,
  moderation_status TEXT NOT NULL DEFAULT 'pending_review',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('missing_person', 'found_person', 'missing_pet', 'found_pet')),
  person_id TEXT REFERENCES people(id),
  pet_id TEXT REFERENCES pets(id),
  status TEXT NOT NULL,
  verification_level TEXT NOT NULL DEFAULT 'unverified',
  public_slug TEXT NOT NULL UNIQUE,
  primary_media_asset_id TEXT,
  last_seen_at TEXT,
  last_seen_text TEXT,
  last_seen_admin1 TEXT,
  last_seen_city TEXT,
  last_seen_lat REAL,
  last_seen_lng REAL,
  location_precision TEXT NOT NULL DEFAULT 'area',
  reporter_name TEXT,
  reporter_contact_private TEXT,
  public_contact_type TEXT,
  public_contact_value TEXT,
  public_contact_consent_at TEXT,
  contact_mode TEXT NOT NULL DEFAULT 'protected_form',
  notes_public TEXT,
  notes_private TEXT,
  source_type TEXT NOT NULL DEFAULT 'community',
  moderation_status TEXT NOT NULL DEFAULT 'pending_review',
  risk_flags_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (primary_media_asset_id) REFERENCES media_assets(id)
);

CREATE INDEX IF NOT EXISTS idx_reports_public_slug ON reports(public_slug);
CREATE INDEX IF NOT EXISTS idx_reports_type_status ON reports(type, status);
CREATE INDEX IF NOT EXISTS idx_reports_moderation ON reports(moderation_status);
CREATE INDEX IF NOT EXISTS idx_reports_location ON reports(last_seen_admin1, last_seen_city);

CREATE TABLE IF NOT EXISTS tips (
  id TEXT PRIMARY KEY,
  report_id TEXT REFERENCES reports(id),
  body TEXT NOT NULL,
  tipper_name TEXT,
  tipper_contact_private TEXT,
  location_text TEXT,
  lat REAL,
  lng REAL,
  occurred_at TEXT,
  media_asset_id TEXT REFERENCES media_assets(id),
  moderation_status TEXT NOT NULL DEFAULT 'pending_review',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tips_report ON tips(report_id);
CREATE INDEX IF NOT EXISTS idx_tips_moderation ON tips(moderation_status);

CREATE TABLE IF NOT EXISTS status_events (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL REFERENCES reports(id),
  old_status TEXT,
  new_status TEXT NOT NULL,
  verification_level TEXT NOT NULL DEFAULT 'unverified',
  source_type TEXT NOT NULL DEFAULT 'community',
  source_note TEXT,
  created_by_user_id TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_status_events_report ON status_events(report_id);

CREATE TABLE IF NOT EXISTS resources (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  address TEXT,
  admin1 TEXT,
  city TEXT,
  lat REAL,
  lng REAL,
  location_precision TEXT NOT NULL DEFAULT 'area',
  hours TEXT,
  capacity TEXT,
  availability_status TEXT NOT NULL DEFAULT 'unknown',
  contact_public TEXT,
  source_url TEXT,
  verification_level TEXT NOT NULL DEFAULT 'unverified',
  organization_id TEXT REFERENCES organizations(id),
  last_verified_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_resources_type ON resources(type);
CREATE INDEX IF NOT EXISTS idx_resources_location ON resources(admin1, city);
CREATE INDEX IF NOT EXISTS idx_resources_availability ON resources(availability_status);

CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  description TEXT,
  website TEXT,
  contact_public TEXT,
  contact_private TEXT,
  verification_status TEXT NOT NULL DEFAULT 'unverified',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  role TEXT NOT NULL DEFAULT 'read_only_observer',
  auth_provider TEXT NOT NULL DEFAULT 'cloudflare_access',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT,
  actor_email TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  reason TEXT,
  ip_hash TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_created_at ON audit_logs(created_at);

CREATE TABLE IF NOT EXISTS admin_areas (
  id TEXT PRIMARY KEY,
  country_code TEXT NOT NULL,
  level TEXT NOT NULL,
  name TEXT NOT NULL,
  ascii_name TEXT,
  parent_id TEXT REFERENCES admin_areas(id),
  lat REAL,
  lng REAL,
  source TEXT NOT NULL DEFAULT 'manual'
);

CREATE INDEX IF NOT EXISTS idx_admin_areas_country ON admin_areas(country_code, level);

CREATE TABLE IF NOT EXISTS moderation_items (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  risk_flags_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'open',
  assigned_to_user_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_moderation_status ON moderation_items(status, created_at);

CREATE TABLE IF NOT EXISTS consent_records (
  id TEXT PRIMARY KEY,
  report_id TEXT REFERENCES reports(id),
  contact_mode TEXT NOT NULL,
  public_contact_type TEXT,
  consent_text TEXT NOT NULL,
  consented_at TEXT NOT NULL,
  ip_hash TEXT
);

CREATE TABLE IF NOT EXISTS emergency_contacts (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  contact TEXT NOT NULL,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS public_updates (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'situation_update',
  source TEXT,
  verification_level TEXT NOT NULL DEFAULT 'unverified',
  locale TEXT NOT NULL DEFAULT 'en',
  pinned INTEGER NOT NULL DEFAULT 0,
  published_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_limit_attempts (
  id TEXT PRIMARY KEY,
  route_key TEXT NOT NULL,
  actor_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_actor ON rate_limit_attempts(route_key, actor_hash, created_at);

INSERT OR IGNORE INTO emergency_contacts (id, label, contact, description, sort_order, created_at, updated_at)
VALUES
  ('contact-emergency-services', 'Emergency services', 'Use your local emergency number', 'emergOS does not replace official emergency services.', 1, datetime('now'), datetime('now')),
  ('contact-takedown', 'Privacy or takedown request', 'Set PRIVACY_CONTACT in admin settings', 'Use this channel to request removal or correction of sensitive information.', 2, datetime('now'), datetime('now'));
