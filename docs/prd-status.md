# PRD Implementation Status

Updated: 2026-06-29

## MVP Status

| Area | Status | Notes |
|---|---|---|
| Cloudflare Workers app | Done | Self-contained app in `apps/emergos-worker`. |
| D1 schema and migrations | Done | Core tables plus safety/contact tables are covered. |
| R2 photo upload | Done | Report and tip media upload to `MEDIA`. |
| Public homepage | Done | First screen starts with crisis actions and search. |
| Missing/found reports | Done | Public submission, listing, detail, and moderation exist. |
| Tips | Done | Case-specific and general public tips submit into moderation. |
| Public search | Done | Unified endpoint searches reports, resources, updates, and organizations. |
| Printable flyer | Done | A4, A5, four-up mini flyers, QR posters, pet flyers, and generated PDF records exist. |
| Resource directory | Done | Public list/detail, admin create/update, CSV import/export, generated sheets, and map features exist. |
| Emergency contacts | Done | Public list plus admin create/update exist. |
| Admin moderation | Done | Reports, tips, protected contact, and abuse/takedown items flow through moderation. |
| Roles | Done | Role model, admin role assignment, organization memberships, and organization-scoped resource/volunteer/dashboard access exist. |
| Verification labels | Done | Reports and resources expose verification labels. |
| Contact visibility consent | Done | Public contact requires explicit consent and records consent. |
| Protected contact | Done | Public protected-contact messages enter moderation. |
| Abuse/takedown requests | Done | Public report/resource requests enter moderation. |
| Turnstile validation | Done | Public write actions validate Turnstile server-side unless local bypass is enabled. |
| Basic locale support | Done | English/Spanish dictionaries, locale override admin, and public locale pack endpoint exist. Full copy QA remains release work. |
| Deploy Button starter | Partial | Wrangler/resources and deploy dry-run script are present; real Deploy Button provisioning still needs external verification. |
| npm CLI generator | Done | Generates standalone configured starters with packaged template, interactive prompts, optional install/migration, and Cloudflare next steps. |
| Tests | Partial | Unit tests and type/build checks exist; integration and E2E coverage still need expansion. |
| Public map UI | Done | `/map` renders mapped reports/resources with layer toggles and list fallback when crisis mode disables maps. |
| Organization portal | Done | Verified organization members can load a scoped portal, edit org profile, and review owned resources/reports. |
| Email ingestion | Partial | Webhook and Email Worker-compatible inbound tips create moderation records; provider-backed outbound delivery setup is deferred. |
| Generated files | Done | Admin can generate flyer PDFs, resource-sheet PDFs/CSVs, and privacy-request JSON exports stored in R2. |
| Missing/found pets | Done | Dedicated `/pets` module, pet report fields, pet-specific details/cards, and pet flyer flow exist. |
| Reporter self-service | Done | Manage links support safe direct updates and route sensitive changes through moderation. |
| Partner API | Done | Token-scoped `/api/v1` read API and OpenAPI endpoint exist for trusted integrations. |
| Retention and crisis settings | Done | Admin can configure retention policy, preview/run cleanup, and toggle low-bandwidth crisis behavior. |
| Notification events | Partial | Email/SMS/WhatsApp notification queue and admin visibility exist; external provider delivery is adapter-gated. |
| Workflows | Partial | Workflow run records, queue processing, and admin controls exist; native Cloudflare Workflows binding is deferred. |
| Offline PWA | Partial | Manifest, service worker, offline manifest endpoint, and public-cache fallback exist; full install QA is deferred. |
| Workers AI | Partial | Admin suggestion/draft endpoints exist with human-review heuristic fallback; real Workers AI binding is optional/deferred. |
| Vectorize/search | Partial | Local semantic index fallback and semantic search endpoint exist; real Vectorize binding is optional/deferred. |
| Observability | Partial | Wrangler observability plus admin command center and health dashboard exist; external error tracking is deferred. |

## Still Missing After Product Completion Slice

- Native Cloudflare Workflows binding/classes for long-running processes.
- Real provider delivery for outbound email/SMS/WhatsApp notifications.
- Native Workers AI and Vectorize bindings for model-backed suggestions and vector search.
- Install QA and broader offline PWA coverage.
- Localization and print-layout QA beyond the current Worker-generated PDFs.
- External error tracking and deeper Cloudflare analytics integration.
- External verification of the Deploy Button flow against a clean Cloudflare account.
- E2E, accessibility, and generated-starter smoke tests beyond the current release check scripts.

## Deferred Roadmap

- Native Cloudflare Workflows for verification, onboarding, imports, reminders, and retention.
- Workers AI-backed moderation suggestions, translation drafts, and summaries.
- Vectorize semantic search and duplicate detection.
- Provider-backed SMS/WhatsApp adapters and outbound notification delivery.
- Production PWA/offline QA.
- Advanced observability integrations.
