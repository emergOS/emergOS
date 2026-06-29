CREATE TABLE IF NOT EXISTS notification_events (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL,
  recipient TEXT NOT NULL,
  template_key TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_by_user_id TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notification_events_status ON notification_events(status, created_at);
CREATE INDEX IF NOT EXISTS idx_notification_events_channel ON notification_events(channel, created_at);

CREATE TABLE IF NOT EXISTS workflow_runs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  step TEXT NOT NULL DEFAULT 'queued',
  payload_json TEXT NOT NULL DEFAULT '{}',
  error TEXT,
  created_by_user_id TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_workflow_runs_status ON workflow_runs(status, created_at);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_entity ON workflow_runs(entity_type, entity_id);

CREATE TABLE IF NOT EXISTS geodata_imports (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  source_filename TEXT,
  bucket_key TEXT,
  total_features INTEGER NOT NULL DEFAULT 0,
  processed_features INTEGER NOT NULL DEFAULT 0,
  error_features INTEGER NOT NULL DEFAULT 0,
  error_json TEXT NOT NULL DEFAULT '[]',
  created_by_user_id TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_geodata_imports_status ON geodata_imports(status, created_at);

CREATE TABLE IF NOT EXISTS ai_suggestions (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  input_json TEXT NOT NULL DEFAULT '{}',
  suggestion_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'suggested',
  created_by_user_id TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_suggestions_entity ON ai_suggestions(entity_type, entity_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_suggestions_type ON ai_suggestions(type, created_at);

CREATE TABLE IF NOT EXISTS semantic_index_records (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  text TEXT NOT NULL,
  keywords TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'indexed',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_semantic_index_entity ON semantic_index_records(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_semantic_index_status ON semantic_index_records(status, updated_at);
