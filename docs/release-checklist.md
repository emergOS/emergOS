# emergOS release checklist

Use this checklist before calling a build deploy-ready.

## Required checks

```bash
pnpm release:check
```

This runs type checks, tests, production builds, the CLI build, and a Worker deploy dry run.

## Cloudflare Deploy Button readiness

- `apps/emergos-worker` must run as a standalone Worker app.
- `wrangler.jsonc` must include D1, R2, KV, Queue, Assets, and required vars.
- `.dev.vars.example` must not contain real secrets.
- D1 migrations must apply locally and remotely.
- First owner access must be documented through `ADMIN_BOOTSTRAP_EMAIL` and Cloudflare Access.
- Placeholder D1/KV IDs must be replaced in production projects before deploy.

## npm package readiness

- `cli/create-emergos` must build with `pnpm --filter create-emergos build`.
- The package must include `dist` and `template`.
- Generated starters must not depend on the monorepo path.
- Generated starters must include `README.md`, `wrangler.jsonc`, `.dev.vars.example`, migrations, Worker source, assets, and app source.
- Generated starters must run `pnpm install`, `pnpm db:migrations:apply:local`, and `pnpm dev`.

## Admin readiness

- Command center shows urgent queues and map/resource coverage.
- Admin navigation is grouped by operational workflow.
- Report/resource/org selectors replace raw IDs where operators choose existing entities.
- Moderation, resources, privacy, users, updates, imports, map data, and audit logs have clear empty states.

## Deferred but feature-flagged

- Native Cloudflare Workflows.
- Provider-backed SMS, WhatsApp, and outbound email.
- Workers AI and Vectorize production bindings.
- Full offline PWA field QA.
