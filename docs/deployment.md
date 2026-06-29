# Deployment

The deployable Worker is in `apps/emergos-worker`.

Cloudflare Deploy Button currently treats a repository subdirectory as the root of the cloned app, so this app does not import runtime code from workspace packages.

## Required Cloudflare Bindings

- `DB`: D1 database for reports, tips, resources, roles, moderation, and audit logs.
- `MEDIA`: R2 bucket for uploaded report and tip media.
- `CONFIG_KV`: KV namespace for cached public config.
- `JOBS`: Queue for duplicate checks, media processing, and future notifications.

## Secrets

Set secrets with Wrangler, not in source:

```bash
wrangler secret put TURNSTILE_SECRET_KEY
wrangler secret put SESSION_SECRET
```

Local development can use `.dev.vars`.
