import { Hono } from "hono";
import QRCode from "qrcode";
import type {
  ContactMode,
  MapLayer,
  PartnerApiScope,
  PublicOrganization,
  PublicReport,
  PublicResource,
  PublicUpdate,
  RetentionPolicy,
  Role,
  ReportStatus,
  ReportType,
  ResourceType,
  VerificationLevel
} from "../src/lib/contracts";
import { getPublicConfig } from "./lib/config";
import {
  audit,
  badRequest,
  DbRow,
  json,
  makeId,
  normalizeText,
  nowIso,
  rowToOrganization,
  rowToReport,
  rowToResource,
  rowToUpdate,
  slugify
} from "./lib/db";
import { assessReportRisk, moderationStatusForFlags } from "./lib/moderation";
import { assertBodySize, getClientIp, hashValue, rateLimit, validateTurnstile } from "./lib/security";
import { Actor, ensureBootstrapUser, requireActor, rolesForAdminOnly } from "./lib/auth";
import { createSimplePdf } from "./lib/generated-files";

type HonoEnv = {
  Bindings: Env;
};

const app = new Hono<HonoEnv>();
const maxSubmissionBytes = 7 * 1024 * 1024;
const allowedImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

app.use("*", async (c, next) => {
  const path = new URL(c.req.url).pathname;
  console.log(JSON.stringify({ message: "request", method: c.req.method, path }));
  await next();
});

app.get("/api/public/config", async (c) => {
  return json(await getPublicConfig(c.env));
});

app.get("/api/public/locales/:locale", async (c) => {
  const locale = c.req.param("locale");
  const rows = await c.env.DB.prepare("SELECT namespace, key, value FROM locale_overrides WHERE locale = ? OR locale = ? ORDER BY locale ASC")
    .bind(locale.split("-")[0], locale)
    .all<DbRow>();
  const overrides: Record<string, string> = {};
  for (const row of rows.results) {
    overrides[`${String(row.namespace)}.${String(row.key)}`] = String(row.value);
  }
  return json({ locale, overrides, generatedAt: nowIso() });
});

app.get("/api/public/offline-manifest", async (c) => {
  const timestamp = nowIso();
  const urls = [
    "/",
    "/search",
    "/reports",
    "/resources",
    "/updates",
    "/organizations",
    "/map",
    "/volunteer",
    "/data-request",
    "/api/public/config",
    "/api/public/emergency-contacts",
    "/api/public/resources",
    "/api/public/updates",
    "/api/public/organizations",
    "/api/public/map-features"
  ];
  return json({ version: timestamp.slice(0, 10), urls, generatedAt: timestamp });
});

app.get("/api/public/search", async (c) => {
  const query = c.req.query("q")?.trim() ?? "";
  const status = c.req.query("status");
  const reportType = c.req.query("type");
  const resourceType = c.req.query("resourceType");
  const verificationLevel = c.req.query("verificationLevel");
  const location = c.req.query("location")?.trim() ?? "";
  const reportFilters = ["r.moderation_status = 'published'"];
  const reportParams: unknown[] = [];
  const resourceFilters: string[] = [];
  const resourceParams: unknown[] = [];
  const updateFilters: string[] = [];
  const updateParams: unknown[] = [];
  const orgFilters: string[] = [];
  const orgParams: unknown[] = [];

  if (status) {
    reportFilters.push("r.status = ?");
    reportParams.push(status);
  }
  if (reportType) {
    reportFilters.push("r.type = ?");
    reportParams.push(reportType);
  }
  if (verificationLevel) {
    reportFilters.push("r.verification_level = ?");
    resourceFilters.push("verification_level = ?");
    orgFilters.push("verification_status = ?");
    reportParams.push(verificationLevel);
    resourceParams.push(verificationLevel);
    orgParams.push(verificationLevel);
  }
  if (query) {
    const normalized = `%${normalizeText(query)}%`;
    const raw = `%${query}%`;
    reportFilters.push("(p.normalized_name LIKE ? OR pet.name LIKE ? OR pet.species LIKE ? OR r.last_seen_city LIKE ? OR r.last_seen_admin1 LIKE ? OR r.last_seen_text LIKE ? OR r.notes_public LIKE ?)");
    reportParams.push(normalized, raw, raw, raw, raw, raw, raw);
    resourceFilters.push("(name LIKE ? OR description LIKE ? OR address LIKE ? OR city LIKE ? OR admin1 LIKE ?)");
    resourceParams.push(raw, raw, raw, raw, raw);
    updateFilters.push("(title LIKE ? OR body LIKE ? OR source LIKE ?)");
    updateParams.push(raw, raw, raw);
    orgFilters.push("(name LIKE ? OR description LIKE ? OR type LIKE ?)");
    orgParams.push(raw, raw, raw);
  }
  if (location) {
    const raw = `%${location}%`;
    reportFilters.push("(r.last_seen_city LIKE ? OR r.last_seen_admin1 LIKE ? OR r.last_seen_text LIKE ?)");
    reportParams.push(raw, raw, raw);
    resourceFilters.push("(city LIKE ? OR admin1 LIKE ? OR address LIKE ?)");
    resourceParams.push(raw, raw, raw);
  }
  if (resourceType) {
    resourceFilters.push("type = ?");
    resourceParams.push(resourceType);
  }

  const [reports, resources, updates, organizations] = await Promise.all([
    c.env.DB.prepare(
      `SELECT
         r.*,
         COALESCE(p.display_name, pet.name) AS display_name,
         p.age AS age,
         COALESCE(p.age_range, pet.species) AS age_range,
         COALESCE(p.description, pet.notes_public, pet.markings) AS description,
         pet.name AS pet_name,
         pet.species AS pet_species,
         pet.breed AS pet_breed,
         pet.color AS pet_color,
         pet.markings AS pet_markings
       FROM reports r
       LEFT JOIN people p ON p.id = r.person_id
       LEFT JOIN pets pet ON pet.id = r.pet_id
       WHERE ${reportFilters.join(" AND ")}
       ORDER BY r.updated_at DESC
       LIMIT 25`
    ).bind(...reportParams).all<DbRow>(),
    c.env.DB.prepare(
      `SELECT * FROM resources
       WHERE ${(resourceFilters.length ? resourceFilters : ["1 = 1"]).join(" AND ")}
       ORDER BY updated_at DESC
       LIMIT 25`
    ).bind(...resourceParams).all<DbRow>(),
    c.env.DB.prepare(
      `SELECT id, title, body, type, source, verification_level, locale, pinned, published_at
       FROM public_updates
       WHERE ${(updateFilters.length ? updateFilters : ["1 = 1"]).join(" AND ")}
       ORDER BY pinned DESC, published_at DESC
       LIMIT 25`
    ).bind(...updateParams).all<DbRow>(),
    c.env.DB.prepare(
      `SELECT * FROM organizations
       WHERE ${(orgFilters.length ? orgFilters : ["1 = 1"]).join(" AND ")}
       ORDER BY updated_at DESC
       LIMIT 25`
    ).bind(...orgParams).all<DbRow>()
  ]);

  return json({
    reports: reports.results.map(rowToReport),
    resources: resources.results.map(rowToResource),
    updates: updates.results.map(rowToUpdate),
    organizations: organizations.results.map(rowToOrganization)
  });
});

app.get("/api/public/search/semantic", async (c) => {
  const query = c.req.query("q")?.trim() ?? "";
  if (!query) return json({ reports: [], resources: [], updates: [], organizations: [] });
  const indexed = await semanticSearch(c.env.DB, query);
  if (indexed.reports.length || indexed.resources.length) {
    return json({ reports: indexed.reports, resources: indexed.resources, updates: [], organizations: [] });
  }
  const raw = `%${query}%`;
  const reportRows = await c.env.DB.prepare(
    `SELECT
       r.*,
       COALESCE(p.display_name, pet.name) AS display_name,
       p.age AS age,
       COALESCE(p.age_range, pet.species) AS age_range,
       COALESCE(p.description, pet.notes_public, pet.markings) AS description
     FROM reports r
     LEFT JOIN people p ON p.id = r.person_id
     LEFT JOIN pets pet ON pet.id = r.pet_id
     WHERE r.moderation_status = 'published'
       AND (p.display_name LIKE ? OR pet.name LIKE ? OR r.last_seen_text LIKE ? OR r.notes_public LIKE ?)
     ORDER BY r.updated_at DESC
     LIMIT 25`
  ).bind(raw, raw, raw, raw).all<DbRow>();
  const resourceRows = await c.env.DB.prepare(
    "SELECT * FROM resources WHERE name LIKE ? OR description LIKE ? OR city LIKE ? OR admin1 LIKE ? ORDER BY updated_at DESC LIMIT 25"
  ).bind(raw, raw, raw, raw).all<DbRow>();
  return json({
    reports: reportRows.results.map(rowToReport),
    resources: resourceRows.results.map(rowToResource),
    updates: [],
    organizations: []
  });
});

app.get("/robots.txt", (c) => {
  const origin = new URL(c.req.url).origin;
  return new Response(`User-agent: *
Allow: /
Disallow: /admin
Sitemap: ${origin}/sitemap.xml
`, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=300"
    }
  });
});

app.get("/sitemap.xml", async (c) => {
  const origin = new URL(c.req.url).origin;
  const staticUrls = ["/", "/reports", "/reports?type=missing_person", "/reports?type=found_person", "/resources"];
  const reports = await c.env.DB.prepare(
    "SELECT public_slug, updated_at FROM reports WHERE moderation_status = 'published' ORDER BY updated_at DESC LIMIT 1000"
  ).all<{ public_slug: string; updated_at: string }>();
  const resources = await c.env.DB.prepare(
    "SELECT id, updated_at FROM resources ORDER BY updated_at DESC LIMIT 1000"
  ).all<{ id: string; updated_at: string }>();

  const urls = [
    ...staticUrls.map((path) => ({ loc: `${origin}${path}`, lastmod: null })),
    ...reports.results.map((report) => ({ loc: `${origin}/reports/${report.public_slug}`, lastmod: report.updated_at })),
    ...resources.results.map((resource) => ({ loc: `${origin}/resources#${resource.id}`, lastmod: resource.updated_at }))
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (url) => `  <url>
    <loc>${escapeXml(url.loc)}</loc>${url.lastmod ? `
    <lastmod>${escapeXml(url.lastmod)}</lastmod>` : ""}
  </url>`
  )
  .join("\n")}
</urlset>`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=300"
    }
  });
});

app.get("/api/public/reports", async (c) => {
  const query = c.req.query("q");
  const status = c.req.query("status");
  const type = c.req.query("type");
  const params: unknown[] = ["published"];
  const filters = ["r.moderation_status = ?"];

  if (status) {
    filters.push("r.status = ?");
    params.push(status);
  }
  if (type) {
    filters.push("r.type = ?");
    params.push(type);
  }
  if (query) {
    const normalized = `%${normalizeText(query)}%`;
    filters.push("(p.normalized_name LIKE ? OR pet.name LIKE ? OR pet.species LIKE ? OR r.last_seen_city LIKE ? OR r.last_seen_admin1 LIKE ? OR r.last_seen_text LIKE ?)");
    params.push(normalized, `%${query}%`, `%${query}%`, `%${query}%`, `%${query}%`, `%${query}%`);
  }

  const result = await c.env.DB.prepare(
    `SELECT
       r.*,
       COALESCE(p.display_name, pet.name) AS display_name,
       p.age AS age,
       COALESCE(p.age_range, pet.species) AS age_range,
       COALESCE(p.description, pet.notes_public, pet.markings) AS description
     FROM reports r
     LEFT JOIN people p ON p.id = r.person_id
     LEFT JOIN pets pet ON pet.id = r.pet_id
     WHERE ${filters.join(" AND ")}
     ORDER BY r.updated_at DESC
     LIMIT 100`
  )
    .bind(...params)
    .all<DbRow>();

  const reports = result.results.map(rowToReport);
  const existingSlugs = new Set(reports.map((report) => report.publicSlug));
  const demoReports = c.env.BYPASS_TURNSTILE === "true"
    ? filterDemoReports({ query, status, type }).filter((report) => !existingSlugs.has(report.publicSlug))
    : [];
  return json({ reports: [...reports, ...demoReports].slice(0, 100) });
});

app.get("/api/public/pets", async (c) => {
  const query = c.req.query("q");
  const status = c.req.query("status");
  const type = c.req.query("type");
  const params: unknown[] = ["published"];
  const filters = ["r.moderation_status = ?", "r.type IN ('missing_pet', 'found_pet')"];

  if (status) {
    filters.push("r.status = ?");
    params.push(status);
  }
  if (type && ["missing_pet", "found_pet"].includes(type)) {
    filters.push("r.type = ?");
    params.push(type);
  }
  if (query) {
    const like = `%${query}%`;
    filters.push("(pet.name LIKE ? OR pet.species LIKE ? OR pet.breed LIKE ? OR pet.color LIKE ? OR pet.markings LIKE ? OR r.last_seen_city LIKE ? OR r.last_seen_text LIKE ?)");
    params.push(like, like, like, like, like, like, like);
  }

  const result = await c.env.DB.prepare(
    `SELECT
       r.*,
       pet.name AS display_name,
       NULL AS age,
       pet.species AS age_range,
       COALESCE(pet.notes_public, pet.markings) AS description,
       pet.name AS pet_name,
       pet.species AS pet_species,
       pet.breed AS pet_breed,
       pet.color AS pet_color,
       pet.markings AS pet_markings
     FROM reports r
     INNER JOIN pets pet ON pet.id = r.pet_id
     WHERE ${filters.join(" AND ")}
     ORDER BY r.updated_at DESC
     LIMIT 100`
  ).bind(...params).all<DbRow>();

  return json({ pets: result.results.map(rowToReport) });
});

app.get("/api/public/pets/:slug", async (c) => {
  const report = await findPublicReport(c.env.DB, c.req.param("slug"));
  if (!report || (report.type !== "missing_pet" && report.type !== "found_pet")) return badRequest("Pet report not found.", 404);
  return json({ pet: report });
});

app.get("/api/public/reports/:slug", async (c) => {
  const slug = c.req.param("slug");
  let report = await findPublicReport(c.env.DB, slug) ?? (c.env.BYPASS_TURNSTILE === "true" ? findDemoReport(slug) : null);
  if (!report) {
    const redirect = await c.env.DB.prepare("SELECT new_slug FROM report_redirects WHERE old_slug = ?").bind(slug).first<{ new_slug: string }>();
    if (redirect) return json({ redirectTo: redirect.new_slug }, { status: 302 });
    return badRequest("Report not found.", 404);
  }

  const tips = await c.env.DB.prepare(
    `SELECT id, body, location_text, occurred_at, created_at
     FROM tips
     WHERE report_id = ? AND moderation_status = 'published'
     ORDER BY created_at DESC
     LIMIT 50`
  )
    .bind(report.id)
    .all<DbRow>();

  return json({ report, tips: tips.results });
});

app.post("/api/public/reports", async (c) => {
  const bodySizeError = assertBodySize(c.req.raw, maxSubmissionBytes);
  if (bodySizeError) return bodySizeError;

  const ip = getClientIp(c.req.raw);
  const ipHash = await hashValue(ip);
  const allowed = await rateLimit(c.env.DB, "public:reports:create", ipHash, 8, 600);
  if (!allowed) return badRequest("Too many submissions. Try again later.", 429);

  const form = await c.req.formData();
  const turnstileError = await validateTurnstile(c.req.raw, c.env, form, "report");
  if (turnstileError) return turnstileError;

  const parsed = parseReportForm(form);
  if ("error" in parsed) return badRequest(parsed.error);

  const reportId = makeId("report");
  const isPetReport = parsed.type === "missing_pet" || parsed.type === "found_pet";
  const personId = isPetReport ? null : makeId("person");
  const petId = isPetReport ? makeId("pet") : null;
  const timestamp = nowIso();
  const config = await getPublicConfig(c.env);
  const publicContactConsent = form.get("publicContactConsent") === "yes";

  if (parsed.contactMode === "public_direct" && (!parsed.publicContactValue || !publicContactConsent)) {
    return badRequest("Public contact requires a contact value and explicit consent.");
  }

  const textForRisk = [parsed.displayName, parsed.description, parsed.notesPublic, parsed.lastSeenText].filter(Boolean).join(" ");
  const riskFlags = assessReportRisk({
    age: parsed.age,
    ageRange: parsed.ageRange,
    status: parsed.status,
    contactMode: parsed.contactMode,
    publicContactConsent,
    text: textForRisk,
    profile: config.disaster.profile
  });
  const moderationStatus = moderationStatusForFlags(riskFlags);
  const publicSlug = slugify(parsed.displayName, reportId);
  const mediaResult = await uploadImage(c.env, form, reportId, "report", "pending_review");
  if ("error" in mediaResult) return mediaResult.error;

  if (isPetReport) {
    await c.env.DB.prepare(
      `INSERT INTO pets (
        id, name, species, breed, color, markings, microchip_private, notes_public, notes_private, medical_notes_private, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        petId,
        parsed.displayName,
        textField(form, "species") ?? parsed.ageRange,
        textField(form, "breed"),
        textField(form, "color"),
        textField(form, "markings") ?? parsed.description,
        textField(form, "microchipPrivate"),
        parsed.notesPublic,
        parsed.notesPrivate,
        textField(form, "medicalNotesPrivate"),
        timestamp,
        timestamp
      )
      .run();
  } else {
    await c.env.DB.prepare(
      `INSERT INTO people (
        id, display_name, normalized_name, age, age_range, gender, description, medical_notes_private, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        personId,
        parsed.displayName,
        normalizeText(parsed.displayName),
        parsed.age,
        parsed.ageRange,
        null,
        parsed.description,
        parsed.medicalNotesPrivate,
        timestamp,
        timestamp
      )
      .run();
  }

  await c.env.DB.prepare(
    `INSERT INTO reports (
      id, type, person_id, pet_id, status, verification_level, public_slug, primary_media_asset_id,
      last_seen_at, last_seen_text, last_seen_admin1, last_seen_city, last_seen_lat, last_seen_lng, location_precision,
      reporter_name, reporter_contact_private, public_contact_type, public_contact_value,
      public_contact_consent_at, contact_mode, notes_public, notes_private, source_type,
      moderation_status, risk_flags_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      reportId,
      parsed.type,
      personId,
      petId,
      parsed.status,
      "unverified",
      publicSlug,
      mediaResult.assetId,
      parsed.lastSeenAt,
      parsed.lastSeenText,
      parsed.lastSeenAdmin1,
      parsed.lastSeenCity,
      parsed.lastSeenLat,
      parsed.lastSeenLng,
      parsed.locationPrecision,
      parsed.reporterName,
      JSON.stringify({ contact: parsed.reporterContact || null }),
      parsed.publicContactType,
      parsed.contactMode === "public_direct" ? parsed.publicContactValue : null,
      parsed.contactMode === "public_direct" ? timestamp : null,
      parsed.contactMode,
      parsed.notesPublic,
      parsed.notesPrivate,
      "community",
      moderationStatus,
      JSON.stringify(riskFlags),
      timestamp,
      timestamp
    )
    .run();

  await c.env.DB.prepare(
    `INSERT INTO status_events (
      id, report_id, old_status, new_status, verification_level, source_type, source_note, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(makeId("status"), reportId, null, parsed.status, "unverified", "community", "Initial submission", timestamp)
    .run();

  if (parsed.contactMode === "public_direct") {
    await c.env.DB.prepare(
      `INSERT INTO consent_records (
        id, report_id, contact_mode, public_contact_type, consent_text, consented_at, ip_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        makeId("consent"),
        reportId,
        parsed.contactMode,
        parsed.publicContactType,
        "Reporter consented that public contact can appear online, on flyers, QR pages, and shared links.",
        timestamp,
        ipHash
      )
      .run();
  }

  if (moderationStatus === "pending_review") {
    await createModerationItem(c.env.DB, "report", reportId, "risk_gated", riskFlags);
  }
  if (mediaResult.assetId) {
    await createModerationItem(c.env.DB, "media_asset", mediaResult.assetId, "media_review", riskFlags);
  }

  const manageToken = createManageToken();
  await c.env.DB.prepare(
    `INSERT INTO report_manage_tokens (id, report_id, token_hash, contact_hint, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(
      makeId("manage"),
      reportId,
      await hashValue(manageToken),
      parsed.reporterContact ? contactHint(parsed.reporterContact) : null,
      null,
      timestamp
    )
    .run();

  await audit(c.env.DB, {
    action: "report_created",
    entityType: "report",
    entityId: reportId,
    after: { type: parsed.type, status: parsed.status, moderationStatus, riskFlags },
    ipHash
  });

  c.executionCtx.waitUntil(Promise.all([
    c.env.JOBS.send({ type: "duplicate_check", reportId, createdAt: timestamp }),
    c.env.JOBS.send({ type: "index_entity", entityType: "report", entityId: reportId, createdAt: timestamp }),
    parsed.reporterContact && parsed.reporterContact.includes("@")
      ? createNotificationEvent(c.env.DB, {
          channel: "email",
          recipient: parsed.reporterContact,
          templateKey: "report_received",
          payload: { reportId, publicSlug, displayName: parsed.displayName },
          userId: null
        }).then((notificationId) => c.env.JOBS.send({ type: "send_notification", notificationId, createdAt: timestamp }))
      : Promise.resolve()
  ]));

  const report = await findReportBySlug(c.env.DB, publicSlug);
  return json({ report, moderationStatus, manageToken, manageUrl: `/reports/${publicSlug}/manage?token=${encodeURIComponent(manageToken)}` }, { status: 201 });
});

app.get("/api/public/reports/:slug/manage", async (c) => {
  const report = await findReportForManage(c.env.DB, c.req.param("slug"), c.req.query("token"));
  if (report instanceof Response) return report;
  const statusEvents = await c.env.DB.prepare(
    "SELECT old_status, new_status, verification_level, source_type, source_note, created_at FROM status_events WHERE report_id = ? ORDER BY created_at ASC"
  ).bind(report.id).all<DbRow>();
  const changeRequests = await c.env.DB.prepare(
    "SELECT * FROM report_change_requests WHERE report_id = ? ORDER BY created_at DESC LIMIT 25"
  ).bind(report.id).all<DbRow>();
  return json({ report, statusEvents: statusEvents.results, changeRequests: changeRequests.results.map(rowToReportChangeRequest), generatedAt: nowIso() });
});

app.patch("/api/public/reports/:slug/manage", async (c) => {
  const bodySizeError = assertBodySize(c.req.raw, maxSubmissionBytes);
  if (bodySizeError) return bodySizeError;
  const report = await findReportForManage(c.env.DB, c.req.param("slug"), c.req.query("token"));
  if (report instanceof Response) return report;

  const form = await c.req.formData();
  const turnstileError = await validateTurnstile(c.req.raw, c.env, form, "report_manage");
  if (turnstileError) return turnstileError;

  const timestamp = nowIso();
  const status = textField(form, "status") as ReportStatus | null;
  const removePublicContact = form.get("removePublicContact") === "yes";
  const notesPublic = textField(form, "notesPublic");
  const lastSeenText = textField(form, "lastSeenText");
  const lastSeenCity = textField(form, "lastSeenCity");
  const lastSeenAdmin1 = textField(form, "lastSeenAdmin1");
  const locationPrecision = textField(form, "locationPrecision");
  const lastSeenLat = numberField(form, "lastSeenLat");
  const lastSeenLng = numberField(form, "lastSeenLng");
  if ((lastSeenLat === null) !== (lastSeenLng === null)) return badRequest("Latitude and longitude must be provided together.");
  if (!validLatLng(lastSeenLat, lastSeenLng)) return badRequest("Coordinates are invalid.");

  const mediaResult = await uploadImage(c.env, form, report.id, "report", "pending_review");
  if ("error" in mediaResult) return mediaResult.error;

  const requestedChange = {
    status,
    notesPublic,
    lastSeenText,
    lastSeenCity,
    lastSeenAdmin1,
    lastSeenLat,
    lastSeenLng,
    locationPrecision,
    mediaAssetId: mediaResult.assetId,
    removePublicContact
  };
  if (reportChangeRequiresReview(report, requestedChange)) {
    const changeRequestId = makeId("chg");
    await c.env.DB.prepare(
      `INSERT INTO report_change_requests (
        id, report_id, requested_by_token_id, change_type, old_json, new_json, reason, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      changeRequestId,
      report.id,
      null,
      "reporter_update",
      JSON.stringify({ status: report.status, locationPrecision: report.locationPrecision, publicContactValue: report.publicContactValue }),
      JSON.stringify(requestedChange),
      textField(form, "statusNote") ?? textField(form, "reason"),
      "pending_review",
      timestamp,
      timestamp
    ).run();
    await createModerationItem(c.env.DB, "report_change_request", changeRequestId, "sensitive_reporter_update", ["sensitive_update"]);
    await audit(c.env.DB, { action: "reporter_change_requested", entityType: "report", entityId: report.id, after: requestedChange });
    return json({ report, moderationStatus: report.moderationStatus, changeRequestId, status: "pending_review" });
  }

  await c.env.DB.prepare(
    `UPDATE reports
     SET status = COALESCE(?, status),
         notes_public = COALESCE(?, notes_public),
         last_seen_text = COALESCE(?, last_seen_text),
         last_seen_city = COALESCE(?, last_seen_city),
         last_seen_admin1 = COALESCE(?, last_seen_admin1),
         last_seen_lat = COALESCE(?, last_seen_lat),
         last_seen_lng = COALESCE(?, last_seen_lng),
         location_precision = COALESCE(?, location_precision),
         primary_media_asset_id = COALESCE(?, primary_media_asset_id),
         public_contact_type = CASE WHEN ? IS NOT NULL THEN NULL ELSE public_contact_type END,
         public_contact_value = CASE WHEN ? IS NOT NULL THEN NULL ELSE public_contact_value END,
         moderation_status = CASE WHEN ? IS NOT NULL OR ? IS NOT NULL THEN 'pending_review' ELSE moderation_status END,
         updated_at = ?
     WHERE id = ?`
  )
    .bind(
      status,
      notesPublic,
      lastSeenText,
      lastSeenCity,
      lastSeenAdmin1,
      lastSeenLat,
      lastSeenLng,
      locationPrecision,
      mediaResult.assetId,
      removePublicContact ? "yes" : null,
      removePublicContact ? "yes" : null,
      notesPublic,
      mediaResult.assetId,
      timestamp,
      report.id
    )
    .run();

  if (status && status !== report.status) {
    await c.env.DB.prepare(
      `INSERT INTO status_events (id, report_id, old_status, new_status, verification_level, source_type, source_note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(makeId("status"), report.id, report.status, status, report.verificationLevel, "reporter", textField(form, "statusNote"), timestamp).run();
  }
  if (notesPublic || mediaResult.assetId) {
    await createModerationItem(c.env.DB, "report", report.id, "reporter_update", ["reporter_update"]);
  }
  await audit(c.env.DB, { action: "reporter_managed_report", entityType: "report", entityId: report.id, after: { status, notesPublic, media: Boolean(mediaResult.assetId) } });
  const updated = await findReportById(c.env.DB, report.id);
  return json({ report: updated, moderationStatus: updated?.moderationStatus ?? "pending_review" });
});

app.post("/api/public/reports/:slug/tips", async (c) => {
  const bodySizeError = assertBodySize(c.req.raw, maxSubmissionBytes);
  if (bodySizeError) return bodySizeError;

  const slug = c.req.param("slug");
  let report = await findPublicReport(c.env.DB, slug) ?? (c.env.BYPASS_TURNSTILE === "true" ? findDemoReport(slug) : null);
  if (!report) return badRequest("Report not found.", 404);

  const ipHash = await hashValue(getClientIp(c.req.raw));
  const allowed = await rateLimit(c.env.DB, "public:tips:create", ipHash, 12, 600);
  if (!allowed) return badRequest("Too many tips. Try again later.", 429);

  const form = await c.req.formData();
  const turnstileError = await validateTurnstile(c.req.raw, c.env, form, "tip");
  if (turnstileError) return turnstileError;

  const body = textField(form, "body");
  if (!body || body.length < 5) return badRequest("Tip body is required.");

  const tipId = makeId("tip");
  const timestamp = nowIso();

  if (report.id.startsWith("demo_")) {
    report = await ensureDemoReportPersisted(c.env.DB, report);
  }

  const mediaResult = await uploadImage(c.env, form, tipId, "tip", "pending_review");
  if ("error" in mediaResult) return mediaResult.error;

  await c.env.DB.prepare(
    `INSERT INTO tips (
      id, report_id, body, tipper_name, tipper_contact_private, location_text, occurred_at, media_asset_id, moderation_status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      tipId,
      report.id,
      body,
      textField(form, "tipperName"),
      JSON.stringify({ contact: textField(form, "tipperContact") }),
      textField(form, "locationText"),
      textField(form, "occurredAt"),
      mediaResult.assetId,
      "pending_review",
      timestamp
    )
    .run();

  await createModerationItem(c.env.DB, "tip", tipId, "new_tip", []);
  await audit(c.env.DB, { action: "tip_created", entityType: "tip", entityId: tipId, ipHash });

  return json({ tipId, moderationStatus: "pending_review" }, { status: 201 });
});

app.post("/api/public/tips", async (c) => {
  const bodySizeError = assertBodySize(c.req.raw, maxSubmissionBytes);
  if (bodySizeError) return bodySizeError;

  const ipHash = await hashValue(getClientIp(c.req.raw));
  const allowed = await rateLimit(c.env.DB, "public:tips:general:create", ipHash, 10, 600);
  if (!allowed) return badRequest("Too many tips. Try again later.", 429);

  const form = await c.req.formData();
  const turnstileError = await validateTurnstile(c.req.raw, c.env, form, "tip");
  if (turnstileError) return turnstileError;

  const body = textField(form, "body");
  if (!body || body.length < 5) return badRequest("Tip body is required.");

  const tipId = makeId("tip");
  const timestamp = nowIso();
  const mediaResult = await uploadImage(c.env, form, tipId, "tip", "pending_review");
  if ("error" in mediaResult) return mediaResult.error;

  await c.env.DB.prepare(
    `INSERT INTO tips (
      id, report_id, body, tipper_name, tipper_contact_private, location_text, occurred_at, media_asset_id, moderation_status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      tipId,
      null,
      body,
      textField(form, "tipperName"),
      JSON.stringify({ contact: textField(form, "tipperContact") }),
      textField(form, "locationText"),
      textField(form, "occurredAt"),
      mediaResult.assetId,
      "pending_review",
      timestamp
    )
    .run();

  await createModerationItem(c.env.DB, "tip", tipId, "general_tip", []);
  await audit(c.env.DB, { action: "general_tip_created", entityType: "tip", entityId: tipId, ipHash });
  return json({ tipId, moderationStatus: "pending_review" }, { status: 201 });
});

app.get("/api/public/resources", async (c) => {
  const result = await c.env.DB.prepare(
    `SELECT *, CASE WHEN protected_location = 1 THEN NULL ELSE lat END AS lat, CASE WHEN protected_location = 1 THEN NULL ELSE lng END AS lng
     FROM resources
     WHERE verification_level IN ('contact_verified', 'org_verified', 'official_verified')
        OR availability_status IN ('open', 'available', 'unknown')
     ORDER BY updated_at DESC
     LIMIT 200`
  ).all<DbRow>();
  return json({ resources: result.results.map(rowToResource) });
});

app.get("/api/public/resources/:id", async (c) => {
  const resource = await c.env.DB.prepare("SELECT *, CASE WHEN protected_location = 1 THEN NULL ELSE lat END AS lat, CASE WHEN protected_location = 1 THEN NULL ELSE lng END AS lng FROM resources WHERE id = ?").bind(c.req.param("id")).first<DbRow>();
  if (!resource) return badRequest("Resource not found.", 404);
  return json({ resource: rowToResource(resource) });
});

app.get("/api/public/emergency-contacts", async (c) => {
  const result = await c.env.DB.prepare(
    "SELECT id, label, contact, description, sort_order FROM emergency_contacts ORDER BY sort_order ASC, label ASC"
  ).all<DbRow>();
  return json({ contacts: result.results });
});

app.get("/api/public/updates", async (c) => {
  const result = await c.env.DB.prepare(
    "SELECT id, title, body, type, source, verification_level, locale, pinned, published_at FROM public_updates ORDER BY pinned DESC, published_at DESC LIMIT 100"
  ).all<DbRow>();
  const updates = result.results.map(rowToUpdate);
  return json({ updates: updates.length || c.env.BYPASS_TURNSTILE !== "true" ? updates : demoPublicUpdates() });
});

app.get("/api/public/updates/:id", async (c) => {
  const update = await c.env.DB.prepare(
    "SELECT id, title, body, type, source, verification_level, locale, pinned, published_at FROM public_updates WHERE id = ?"
  ).bind(c.req.param("id")).first<DbRow>();
  const demoUpdate = c.env.BYPASS_TURNSTILE === "true" ? demoPublicUpdates().find((item) => item.id === c.req.param("id")) : null;
  if (!update && demoUpdate) return json({ update: demoUpdate });
  if (!update) return badRequest("Public update not found.", 404);
  return json({ update: rowToUpdate(update) });
});

app.get("/api/public/organizations", async (c) => {
  const result = await c.env.DB.prepare(
    `SELECT * FROM organizations
     WHERE verification_status IN ('contact_verified', 'org_verified', 'official_verified')
     ORDER BY updated_at DESC
     LIMIT 100`
  ).all<DbRow>();
  const organizations = result.results.map(rowToOrganization);
  return json({ organizations: organizations.length || c.env.BYPASS_TURNSTILE !== "true" ? organizations : demoOrganizations() });
});

app.get("/api/public/organizations/:id", async (c) => {
  const organization = await c.env.DB.prepare(
    `SELECT * FROM organizations
     WHERE id = ?
       AND verification_status IN ('contact_verified', 'org_verified', 'official_verified')`
  ).bind(c.req.param("id")).first<DbRow>();
  const demoOrganization = c.env.BYPASS_TURNSTILE === "true" ? demoOrganizations().find((item) => item.id === c.req.param("id")) : null;
  if (!organization && demoOrganization) {
    return json({
      organization: demoOrganization,
      resources: demoOrganizationResources(demoOrganization.id)
    });
  }
  if (!organization) return badRequest("Organization not found.", 404);

  const resources = await c.env.DB.prepare(
    `SELECT *, CASE WHEN protected_location = 1 THEN NULL ELSE lat END AS lat, CASE WHEN protected_location = 1 THEN NULL ELSE lng END AS lng
     FROM resources
     WHERE organization_id = ?
       AND (verification_level IN ('contact_verified', 'org_verified', 'official_verified')
        OR availability_status IN ('open', 'available', 'unknown'))
     ORDER BY updated_at DESC
     LIMIT 100`
  ).bind(c.req.param("id")).all<DbRow>();

  return json({
    organization: rowToOrganization(organization),
    resources: resources.results.map(rowToResource)
  });
});

app.post("/api/public/organizations/apply", async (c) => {
  const ipHash = await hashValue(getClientIp(c.req.raw));
  const allowed = await rateLimit(c.env.DB, "public:organizations:apply", ipHash, 4, 600);
  if (!allowed) return badRequest("Too many organization applications. Try again later.", 429);
  const form = await c.req.formData();
  const turnstileError = await validateTurnstile(c.req.raw, c.env, form, "organization_application");
  if (turnstileError) return turnstileError;
  const name = textField(form, "name");
  const type = textField(form, "type");
  const contact = textField(form, "contactPrivate");
  if (!name || !type || !contact) return badRequest("Organization name, type, and private contact are required.");
  const id = makeId("orgapp");
  const timestamp = nowIso();
  await c.env.DB.prepare(
    `INSERT INTO organization_applications (
      id, name, type, description, website, contact_public, contact_private, verification_evidence, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      name,
      type,
      textField(form, "description"),
      textField(form, "website"),
      textField(form, "contactPublic"),
      JSON.stringify({ contact }),
      textField(form, "verificationEvidence"),
      "pending_review",
      timestamp,
      timestamp
    )
    .run();
  await createModerationItem(c.env.DB, "organization_application", id, "organization_application", ["org_verification_needed"]);
  await audit(c.env.DB, { action: "organization_application_created", entityType: "organization_application", entityId: id, ipHash });
  return json({ applicationId: id, status: "pending_review" }, { status: 201 });
});

app.get("/api/public/map-features", async (c) => {
  const [resources, reports, layers] = await Promise.all([
    c.env.DB.prepare(
      `SELECT id, type, name, address, city, admin1, lat, lng, location_precision, verification_level, availability_status, updated_at
       FROM resources
       WHERE lat IS NOT NULL AND lng IS NOT NULL
         AND location_precision != 'hidden'
         AND protected_location = 0
       ORDER BY updated_at DESC
       LIMIT 500`
    ).all<DbRow>(),
    c.env.DB.prepare(
      `SELECT r.id, r.public_slug, r.type, r.status, r.last_seen_text, r.last_seen_city, r.last_seen_admin1,
              r.last_seen_lat, r.last_seen_lng, r.location_precision, r.verification_level, r.updated_at,
              COALESCE(p.display_name, pet.name) AS display_name
       FROM reports r
       LEFT JOIN people p ON p.id = r.person_id
       LEFT JOIN pets pet ON pet.id = r.pet_id
       WHERE r.moderation_status = 'published'
         AND r.last_seen_lat IS NOT NULL
         AND r.last_seen_lng IS NOT NULL
         AND r.location_precision != 'hidden'
       ORDER BY r.updated_at DESC
      LIMIT 500`
    ).all<DbRow>(),
    c.env.DB.prepare(
      `SELECT * FROM map_layers
       WHERE status = 'active' AND visibility = 'public'
       ORDER BY updated_at DESC
       LIMIT 300`
    ).all<DbRow>()
  ]);

  const features = [
      ...resources.results.map((row) => ({
        id: String(row.id),
        type: "resource",
        label: String(row.name),
        category: String(row.type),
        status: String(row.availability_status ?? "unknown"),
        locationLabel: [row.address, row.city, row.admin1].filter(Boolean).map(String).join(", ") || null,
        lat: Number(row.lat),
        lng: Number(row.lng),
        precision: String(row.location_precision ?? "area"),
        url: `/resources/${String(row.id)}`,
        verificationLevel: String(row.verification_level ?? "unverified"),
        updatedAt: String(row.updated_at)
      })),
      ...reports.results.map((row) => ({
        id: String(row.id),
        type: "report",
        label: String(row.display_name ?? "Report"),
        category: String(row.type),
        status: String(row.status ?? "missing"),
        locationLabel: [row.last_seen_text, row.last_seen_city, row.last_seen_admin1].filter(Boolean).map(String).join(", ") || null,
        lat: Number(row.last_seen_lat),
        lng: Number(row.last_seen_lng),
        precision: String(row.location_precision ?? "area"),
        url: `/reports/${String(row.public_slug)}`,
        verificationLevel: String(row.verification_level ?? "unverified"),
        updatedAt: String(row.updated_at)
      })),
      ...layers.results.map(rowToMapLayerFeature)
    ];

  return json({
    features: features.length || c.env.BYPASS_TURNSTILE !== "true" ? features : demoMapFeatures()
  });
});

app.get("/api/v1/openapi.json", (c) => json(partnerOpenApiSpec()));

app.get("/api/v1/reports", async (c) => {
  const auth = await requirePartnerScope(c.env.DB, c.req.raw, "reports:read");
  if (auth instanceof Response) return auth;
  const rows = await c.env.DB.prepare(
    `SELECT r.*, COALESCE(p.display_name, pet.name) AS display_name, p.age AS age,
            COALESCE(p.age_range, pet.species) AS age_range,
            COALESCE(p.description, pet.notes_public, pet.markings) AS description,
            pet.name AS pet_name, pet.species AS pet_species, pet.breed AS pet_breed,
            pet.color AS pet_color, pet.markings AS pet_markings
     FROM reports r
     LEFT JOIN people p ON p.id = r.person_id
     LEFT JOIN pets pet ON pet.id = r.pet_id
     WHERE r.moderation_status = 'published' AND r.type IN ('missing_person', 'found_person')
     ORDER BY r.updated_at DESC LIMIT 200`
  ).all<DbRow>();
  return json(v1List(rows.results.map(rowToReport)));
});

app.get("/api/v1/reports/:slug", async (c) => {
  const auth = await requirePartnerScope(c.env.DB, c.req.raw, "reports:read");
  if (auth instanceof Response) return auth;
  const report = await findPublicReport(c.env.DB, c.req.param("slug"));
  if (!report || report.subjectType === "pet") return badRequest("Report not found.", 404);
  return json({ data: report, generatedAt: nowIso() });
});

app.get("/api/v1/pets", async (c) => {
  const auth = await requirePartnerScope(c.env.DB, c.req.raw, "pets:read");
  if (auth instanceof Response) return auth;
  const rows = await c.env.DB.prepare(
    `SELECT r.*, pet.name AS display_name, NULL AS age, pet.species AS age_range,
            COALESCE(pet.notes_public, pet.markings) AS description,
            pet.name AS pet_name, pet.species AS pet_species, pet.breed AS pet_breed,
            pet.color AS pet_color, pet.markings AS pet_markings
     FROM reports r
     INNER JOIN pets pet ON pet.id = r.pet_id
     WHERE r.moderation_status = 'published' AND r.type IN ('missing_pet', 'found_pet')
     ORDER BY r.updated_at DESC LIMIT 200`
  ).all<DbRow>();
  return json(v1List(rows.results.map(rowToReport)));
});

app.get("/api/v1/resources", async (c) => {
  const auth = await requirePartnerScope(c.env.DB, c.req.raw, "resources:read");
  if (auth instanceof Response) return auth;
  const rows = await c.env.DB.prepare(
    `SELECT *, CASE WHEN protected_location = 1 THEN NULL ELSE lat END AS lat, CASE WHEN protected_location = 1 THEN NULL ELSE lng END AS lng
     FROM resources
     WHERE verification_level IN ('contact_verified', 'org_verified', 'official_verified') OR availability_status IN ('open', 'available', 'unknown')
     ORDER BY updated_at DESC LIMIT 200`
  ).all<DbRow>();
  return json(v1List(rows.results.map(rowToResource)));
});

app.get("/api/v1/organizations", async (c) => {
  const auth = await requirePartnerScope(c.env.DB, c.req.raw, "organizations:read");
  if (auth instanceof Response) return auth;
  const rows = await c.env.DB.prepare(
    "SELECT * FROM organizations WHERE verification_status IN ('contact_verified', 'org_verified', 'official_verified') ORDER BY updated_at DESC LIMIT 200"
  ).all<DbRow>();
  return json(v1List(rows.results.map(rowToOrganization)));
});

app.get("/api/v1/updates", async (c) => {
  const auth = await requirePartnerScope(c.env.DB, c.req.raw, "updates:read");
  if (auth instanceof Response) return auth;
  const rows = await c.env.DB.prepare(
    "SELECT id, title, body, type, source, verification_level, locale, pinned, published_at FROM public_updates ORDER BY pinned DESC, published_at DESC LIMIT 200"
  ).all<DbRow>();
  return json(v1List(rows.results.map(rowToUpdate)));
});

app.get("/api/v1/map-features", async (c) => {
  const auth = await requirePartnerScope(c.env.DB, c.req.raw, "map:read");
  if (auth instanceof Response) return auth;
  const response = await app.request("/api/public/map-features", {}, c.env);
  return response;
});

app.post("/api/public/volunteers", async (c) => {
  const ipHash = await hashValue(getClientIp(c.req.raw));
  const allowed = await rateLimit(c.env.DB, "public:volunteers:create", ipHash, 6, 600);
  if (!allowed) return badRequest("Too many volunteer registrations. Try again later.", 429);

  const form = await c.req.formData();
  const turnstileError = await validateTurnstile(c.req.raw, c.env, form, "volunteer");
  if (turnstileError) return turnstileError;

  const name = textField(form, "name");
  const contact = textField(form, "contact");
  const consent = form.get("consentShare") === "yes";
  if (!name || !contact || !consent) return badRequest("Name, contact, and sharing consent are required.");

  const id = makeId("volunteer");
  const timestamp = nowIso();
  await c.env.DB.prepare(
    `INSERT INTO volunteers (
      id, name, contact_private, location, skills, languages, availability, transport_access,
      credentials_private, consent_share_with_orgs_at, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      name,
      JSON.stringify({ contact }),
      textField(form, "location"),
      textField(form, "skills"),
      textField(form, "languages"),
      textField(form, "availability"),
      textField(form, "transportAccess"),
      textField(form, "credentials"),
      timestamp,
      "pending",
      timestamp,
      timestamp
    )
    .run();
  await createModerationItem(c.env.DB, "volunteer", id, "volunteer_registration", []);
  await audit(c.env.DB, { action: "volunteer_registered", entityType: "volunteer", entityId: id, ipHash });
  return json({ volunteerId: id, moderationStatus: "pending_review" }, { status: 201 });
});

app.post("/api/public/data-requests", async (c) => {
  const ipHash = await hashValue(getClientIp(c.req.raw));
  const allowed = await rateLimit(c.env.DB, "public:data_requests:create", ipHash, 6, 600);
  if (!allowed) return badRequest("Too many data requests. Try again later.", 429);

  const form = await c.req.formData();
  const turnstileError = await validateTurnstile(c.req.raw, c.env, form, "data_request");
  if (turnstileError) return turnstileError;

  const type = textField(form, "type");
  const contact = textField(form, "requesterContact");
  if (!type || !contact) return badRequest("Request type and contact are required.");

  const id = makeId("datareq");
  const timestamp = nowIso();
  await c.env.DB.prepare(
    `INSERT INTO data_requests (
      id, type, report_id, requester_contact_private, details, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(id, type, textField(form, "reportId"), JSON.stringify({ contact }), textField(form, "details"), "open", timestamp, timestamp)
    .run();
  await createModerationItem(c.env.DB, "data_request", id, "privacy_request", []);
  await audit(c.env.DB, { action: "data_request_created", entityType: "data_request", entityId: id, ipHash });
  return json({ dataRequestId: id, status: "open" }, { status: 201 });
});

app.post("/api/webhooks/email-tip", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Partial<{
    from: string;
    to: string;
    subject: string;
    text: string;
    reportSlug: string;
  }>;
  if (!body.text || body.text.trim().length < 5) return badRequest("Email body text is required.");

  let report: PublicReport | null = null;
  if (body.reportSlug) {
    report = await findPublicReport(c.env.DB, body.reportSlug);
    if (!report) return badRequest("Related report not found.", 404);
  }

  const timestamp = nowIso();
  const inboundId = makeId("email");
  let tipId: string | null = null;
  if (report) {
    tipId = makeId("tip");
    await c.env.DB.prepare(
      `INSERT INTO tips (
        id, report_id, body, tipper_name, tipper_contact_private, location_text, moderation_status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        tipId,
        report.id,
        body.text.trim(),
        body.from ?? null,
        JSON.stringify({ email: body.from ?? null }),
        null,
        "pending_review",
        timestamp
      )
      .run();
    await createModerationItem(c.env.DB, "tip", tipId, "email_tip", []);
  }

  await c.env.DB.prepare(
    `INSERT INTO inbound_emails (
      id, from_email, to_email, subject, body_text, related_report_id, created_tip_id, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(inboundId, body.from ?? null, body.to ?? null, body.subject ?? null, body.text.trim(), report?.id ?? null, tipId, "pending_review", timestamp, timestamp)
    .run();
  await audit(c.env.DB, { action: "inbound_email_received", entityType: "inbound_email", entityId: inboundId, after: { relatedReportId: report?.id ?? null, tipId } });
  return json({ inboundEmailId: inboundId, tipId }, { status: 201 });
});

app.post("/api/public/reports/:slug/contact", async (c) => {
  const slug = c.req.param("slug");
  const report = await findPublicReport(c.env.DB, slug) ?? (c.env.BYPASS_TURNSTILE === "true" ? findDemoReport(slug) : null);
  if (!report) return badRequest("Report not found.", 404);
  if (report.contactMode !== "protected_form" && report.contactMode !== "organization_mediated") {
    return badRequest("This report uses public contact details.");
  }

  const ipHash = await hashValue(getClientIp(c.req.raw));
  const allowed = await rateLimit(c.env.DB, "public:contact:create", ipHash, 8, 600);
  if (!allowed) return badRequest("Too many messages. Try again later.", 429);

  const form = await c.req.formData();
  const turnstileError = await validateTurnstile(c.req.raw, c.env, form, "contact");
  if (turnstileError) return turnstileError;

  const body = textField(form, "body");
  if (!body || body.length < 10) return badRequest("Message must be at least 10 characters.");

  const persisted = report.id.startsWith("demo_") ? await ensureDemoReportPersisted(c.env.DB, report) : report;
  const id = makeId("contact");
  const timestamp = nowIso();
  await c.env.DB.prepare(
    `INSERT INTO contact_messages (
      id, report_id, sender_name, sender_contact_private, body, moderation_status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      persisted.id,
      textField(form, "senderName"),
      JSON.stringify({ contact: textField(form, "senderContact") }),
      body,
      "pending_review",
      timestamp,
      timestamp
    )
    .run();

  await createModerationItem(c.env.DB, "contact_message", id, "protected_contact", []);
  await audit(c.env.DB, { action: "contact_message_created", entityType: "contact_message", entityId: id, ipHash });
  return json({ messageId: id, moderationStatus: "pending_review" }, { status: 201 });
});

app.post("/api/public/abuse-reports", async (c) => {
  const ipHash = await hashValue(getClientIp(c.req.raw));
  const allowed = await rateLimit(c.env.DB, "public:abuse:create", ipHash, 10, 600);
  if (!allowed) return badRequest("Too many requests. Try again later.", 429);

  const form = await c.req.formData();
  const turnstileError = await validateTurnstile(c.req.raw, c.env, form, "abuse");
  if (turnstileError) return turnstileError;

  const reportSlug = textField(form, "reportSlug");
  const resourceId = textField(form, "resourceId");
  const reason = textField(form, "reason");
  if (!reason || reason.length < 3) return badRequest("Reason is required.");
  if (!reportSlug && !resourceId) return badRequest("A report or resource reference is required.");

  let reportId: string | null = null;
  if (reportSlug) {
    const report = await findPublicReport(c.env.DB, reportSlug) ?? (c.env.BYPASS_TURNSTILE === "true" ? findDemoReport(reportSlug) : null);
    if (!report) return badRequest("Report not found.", 404);
    reportId = report.id.startsWith("demo_") ? (await ensureDemoReportPersisted(c.env.DB, report)).id : report.id;
  }

  if (resourceId) {
    const resource = await c.env.DB.prepare("SELECT id FROM resources WHERE id = ?").bind(resourceId).first<{ id: string }>();
    if (!resource) return badRequest("Resource not found.", 404);
  }

  const id = makeId("abuse");
  const timestamp = nowIso();
  await c.env.DB.prepare(
    `INSERT INTO abuse_reports (
      id, report_id, resource_id, reason, details, requester_contact_private, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      reportId,
      resourceId,
      reason,
      textField(form, "details"),
      JSON.stringify({ contact: textField(form, "requesterContact") }),
      "open",
      timestamp,
      timestamp
    )
    .run();
  await createModerationItem(c.env.DB, "abuse_report", id, "abuse_or_takedown", []);
  await audit(c.env.DB, { action: "abuse_report_created", entityType: "abuse_report", entityId: id, ipHash });
  return json({ abuseReportId: id, moderationStatus: "pending_review" }, { status: 201 });
});

app.get("/reports/:slug/print", async (c) => {
  const slug = c.req.param("slug");
  const report = await findPublicReport(c.env.DB, slug) ?? (c.env.BYPASS_TURNSTILE === "true" ? findDemoReport(slug) : null);
  if (!report) {
    const redirect = await c.env.DB.prepare("SELECT new_slug FROM report_redirects WHERE old_slug = ?").bind(slug).first<{ new_slug: string }>();
    if (redirect) return c.redirect(`/reports/${redirect.new_slug}/print`, 301);
    return new Response("Report not found", { status: 404 });
  }
  const format = flyerFormat(c.req.query("format"), report);
  const url = new URL(`/reports/${report.publicSlug}`, c.req.url).toString();
  const qrSvg = await QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
  return new Response(renderFlyer(report, url, qrSvg, format), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
});

app.get("/api/public/flyers/:slug", (c) => {
  return c.redirect(`/reports/${c.req.param("slug")}/print`, 301);
});

app.get("/media/:id", async (c) => {
  const media = await c.env.DB.prepare("SELECT bucket_key, mime_type FROM media_assets WHERE id = ? AND moderation_status = 'published'")
    .bind(c.req.param("id"))
    .first<{ bucket_key: string; mime_type: string }>();
  if (!media) return new Response("Not found", { status: 404 });

  const object = await c.env.MEDIA.get(media.bucket_key);
  if (!object) return new Response("Not found", { status: 404 });

  return new Response(object.body, {
    headers: {
      "Content-Type": object.httpMetadata?.contentType ?? media.mime_type,
      "Cache-Control": "public, max-age=3600"
    }
  });
});

app.get("/api/public/generated-files/:id", async (c) => {
  const file = await c.env.DB.prepare("SELECT bucket_key, mime_type FROM generated_files WHERE id = ? AND status = 'complete'")
    .bind(c.req.param("id"))
    .first<{ bucket_key: string; mime_type: string }>();
  if (!file) return new Response("Not found", { status: 404 });
  const object = await c.env.MEDIA.get(file.bucket_key);
  if (!object) return new Response("Not found", { status: 404 });
  return new Response(object.body, {
    headers: {
      "Content-Type": file.mime_type,
      "Content-Disposition": `attachment; filename="${c.req.param("id")}"`
    }
  });
});

app.get("/api/admin/dashboard", async (c) => {
  await ensureBootstrapUser(c.env);
  const actor = await requireActor(c.req.raw, c.env);
  if (actor instanceof Response) return actor;

  const [
    openMissingCases,
    reportedSafeOrFound,
    pendingModeration,
    newTips24h,
    resourcesNeedingUpdate,
    mappedResources,
    unmappedResources,
    mappedReports,
    unmappedReports,
    hiddenMapResources,
    hiddenMapReports,
    invalidResourceCoordinates,
    invalidReportCoordinates,
    publicUpdates,
    publicOrganizations
  ] = await Promise.all([
    count(c.env.DB, "SELECT COUNT(*) AS count FROM reports WHERE type = 'missing_person' AND status = 'missing'"),
    count(c.env.DB, "SELECT COUNT(*) AS count FROM reports WHERE status IN ('reported_safe', 'found_needs_help')"),
    count(c.env.DB, "SELECT COUNT(*) AS count FROM moderation_items WHERE status = 'open'"),
    count(c.env.DB, "SELECT COUNT(*) AS count FROM tips WHERE created_at >= datetime('now', '-1 day')"),
    count(c.env.DB, "SELECT COUNT(*) AS count FROM resources WHERE last_verified_at IS NULL OR last_verified_at < datetime('now', '-1 day')"),
    count(c.env.DB, "SELECT COUNT(*) AS count FROM resources WHERE lat IS NOT NULL AND lng IS NOT NULL AND location_precision != 'hidden'"),
    count(c.env.DB, "SELECT COUNT(*) AS count FROM resources WHERE lat IS NULL OR lng IS NULL"),
    count(c.env.DB, "SELECT COUNT(*) AS count FROM reports WHERE moderation_status = 'published' AND last_seen_lat IS NOT NULL AND last_seen_lng IS NOT NULL AND location_precision != 'hidden'"),
    count(c.env.DB, "SELECT COUNT(*) AS count FROM reports WHERE moderation_status = 'published' AND (last_seen_lat IS NULL OR last_seen_lng IS NULL)"),
    count(c.env.DB, "SELECT COUNT(*) AS count FROM resources WHERE location_precision = 'hidden'"),
    count(c.env.DB, "SELECT COUNT(*) AS count FROM reports WHERE location_precision = 'hidden'"),
    count(c.env.DB, "SELECT COUNT(*) AS count FROM resources WHERE (lat IS NOT NULL AND (lat < -90 OR lat > 90)) OR (lng IS NOT NULL AND (lng < -180 OR lng > 180))"),
    count(c.env.DB, "SELECT COUNT(*) AS count FROM reports WHERE (last_seen_lat IS NOT NULL AND (last_seen_lat < -90 OR last_seen_lat > 90)) OR (last_seen_lng IS NOT NULL AND (last_seen_lng < -180 OR last_seen_lng > 180))"),
    count(c.env.DB, "SELECT COUNT(*) AS count FROM public_updates"),
    count(c.env.DB, "SELECT COUNT(*) AS count FROM organizations WHERE verification_status IN ('contact_verified', 'org_verified', 'official_verified')")
  ]);

  return json({
    metrics: {
      openMissingCases,
      reportedSafeOrFound,
      pendingModeration,
      newTips24h,
      resourcesNeedingUpdate,
      mappedResources,
      unmappedResources,
      mappedReports,
      unmappedReports,
      hiddenMapRecords: hiddenMapResources + hiddenMapReports,
      invalidCoordinateRecords: invalidResourceCoordinates + invalidReportCoordinates,
      publicUpdates,
      publicOrganizations
    }
  });
});

app.get("/api/admin/reports", async (c) => {
  await ensureBootstrapUser(c.env);
  const actor = await requireActor(c.req.raw, c.env);
  if (actor instanceof Response) return actor;

  const result = await c.env.DB.prepare(
    `SELECT
       r.*,
       COALESCE(p.display_name, pet.name) AS display_name,
       p.age AS age,
       COALESCE(p.age_range, pet.species) AS age_range,
       COALESCE(p.description, pet.notes_public, pet.markings) AS description
     FROM reports r
     LEFT JOIN people p ON p.id = r.person_id
     LEFT JOIN pets pet ON pet.id = r.pet_id
     ORDER BY r.updated_at DESC
     LIMIT 200`
  ).all<DbRow>();
  return json({ reports: result.results.map(rowToReport) });
});

app.patch("/api/admin/reports/:id", async (c) => {
  await ensureBootstrapUser(c.env);
  const actor = await requireActor(c.req.raw, c.env);
  if (actor instanceof Response) return actor;

  const body = (await c.req.json()) as Partial<{
    displayName: string;
    description: string;
    notesPublic: string;
    lastSeenText: string;
    lastSeenCity: string;
    lastSeenAdmin1: string;
    lastSeenLat: number | string;
    lastSeenLng: number | string;
    locationPrecision: string;
    moderationStatus: string;
    verificationLevel: VerificationLevel;
  }>;
  const existing = await c.env.DB.prepare("SELECT id, person_id, pet_id FROM reports WHERE id = ?").bind(c.req.param("id")).first<DbRow>();
  if (!existing) return badRequest("Report not found.", 404);
  const lastSeenLat = bodyNumber(body.lastSeenLat);
  const lastSeenLng = bodyNumber(body.lastSeenLng);
  if ((lastSeenLat === null) !== (lastSeenLng === null)) return badRequest("Latitude and longitude must be provided together.");
  if (!validLatLng(lastSeenLat, lastSeenLng)) return badRequest("Coordinates are invalid.");
  const timestamp = nowIso();

  await c.env.DB.prepare(
    `UPDATE reports
     SET notes_public = COALESCE(?, notes_public),
         last_seen_text = COALESCE(?, last_seen_text),
         last_seen_city = COALESCE(?, last_seen_city),
         last_seen_admin1 = COALESCE(?, last_seen_admin1),
         last_seen_lat = COALESCE(?, last_seen_lat),
         last_seen_lng = COALESCE(?, last_seen_lng),
         location_precision = COALESCE(?, location_precision),
         moderation_status = COALESCE(?, moderation_status),
         verification_level = COALESCE(?, verification_level),
         updated_at = ?
     WHERE id = ?`
  )
    .bind(
      body.notesPublic ?? null,
      body.lastSeenText ?? null,
      body.lastSeenCity ?? null,
      body.lastSeenAdmin1 ?? null,
      lastSeenLat,
      lastSeenLng,
      body.locationPrecision ?? null,
      body.moderationStatus ?? null,
      body.verificationLevel ?? null,
      timestamp,
      c.req.param("id")
    )
    .run();

  if (existing.person_id && (body.displayName || body.description)) {
    await c.env.DB.prepare(
      "UPDATE people SET display_name = COALESCE(?, display_name), normalized_name = COALESCE(?, normalized_name), description = COALESCE(?, description), updated_at = ? WHERE id = ?"
    )
      .bind(
        body.displayName ?? null,
        body.displayName ? normalizeText(body.displayName) : null,
        body.description ?? null,
        timestamp,
        existing.person_id
      )
      .run();
  }
  if (existing.pet_id && (body.displayName || body.description)) {
    await c.env.DB.prepare(
      "UPDATE pets SET name = COALESCE(?, name), notes_public = COALESCE(?, notes_public), updated_at = ? WHERE id = ?"
    )
      .bind(body.displayName ?? null, body.description ?? null, timestamp, existing.pet_id)
      .run();
  }

  await audit(c.env.DB, {
    actorEmail: actor.email,
    action: "report_updated",
    entityType: "report",
    entityId: c.req.param("id"),
    after: body
  });
  return json({ ok: true });
});

app.get("/api/admin/tips", async (c) => {
  await ensureBootstrapUser(c.env);
  const actor = await requireActor(c.req.raw, c.env);
  if (actor instanceof Response) return actor;

  const result = await c.env.DB.prepare(
    `SELECT t.*, r.public_slug, COALESCE(p.display_name, pet.name) AS report_display_name
     FROM tips t
     LEFT JOIN reports r ON r.id = t.report_id
     LEFT JOIN people p ON p.id = r.person_id
     LEFT JOIN pets pet ON pet.id = r.pet_id
     ORDER BY t.created_at DESC
     LIMIT 200`
  ).all<DbRow>();
  return json({ tips: result.results });
});

app.get("/api/admin/work-queue", async (c) => {
  await ensureBootstrapUser(c.env);
  const actor = await requireActor(c.req.raw, c.env);
  if (actor instanceof Response) return actor;
  const lane = c.req.query("lane");
  const params: unknown[] = [];
  const filters = ["mi.status IN ('open', 'needs_info')"];
  if (lane) {
    filters.push("mi.lane = ?");
    params.push(lane);
  }
  const rows = await c.env.DB.prepare(
    `SELECT mi.*, t.body AS tip_body, tr.public_slug AS report_public_slug, tr.type AS report_type,
            COALESCE(p.display_name, pet.name) AS report_display_name,
            ma.mime_type AS media_mime_type, ma.moderation_status AS media_moderation_status,
            rcr.change_type AS change_type, rcr.new_json AS change_new_json,
            ar.reason AS abuse_reason, ar.details AS abuse_details
     FROM moderation_items mi
     LEFT JOIN tips t ON mi.entity_type = 'tip' AND t.id = mi.entity_id
     LEFT JOIN abuse_reports ar ON mi.entity_type = 'abuse_report' AND ar.id = mi.entity_id
     LEFT JOIN media_assets ma ON mi.entity_type = 'media_asset' AND ma.id = mi.entity_id
     LEFT JOIN report_change_requests rcr ON mi.entity_type = 'report_change_request' AND rcr.id = mi.entity_id
     LEFT JOIN reports tr ON tr.id = t.report_id OR tr.id = ar.report_id OR tr.id = rcr.report_id OR (mi.entity_type = 'report' AND tr.id = mi.entity_id)
     LEFT JOIN people p ON p.id = tr.person_id
     LEFT JOIN pets pet ON pet.id = tr.pet_id
     WHERE ${filters.join(" AND ")}
     ORDER BY mi.priority DESC, mi.created_at ASC
     LIMIT 200`
  ).bind(...params).all<DbRow>();
  return json({ items: rows.results });
});

app.get("/api/admin/moderation", async (c) => {
  await ensureBootstrapUser(c.env);
  const actor = await requireActor(c.req.raw, c.env);
  if (actor instanceof Response) return actor;

  const items = await c.env.DB.prepare(
    `SELECT
       mi.*,
       t.body AS tip_body,
       t.location_text AS tip_location_text,
       t.tipper_contact_private AS tipper_contact_private,
       t.created_at AS tip_created_at,
       tr.public_slug AS report_public_slug,
       tr.type AS report_type,
       COALESCE(p.display_name, pet.name) AS report_display_name,
       p.age AS report_age,
       COALESCE(p.age_range, pet.species) AS report_age_range,
       tr.last_seen_city AS report_last_seen_city,
       tr.last_seen_admin1 AS report_last_seen_admin1,
       tr.status AS report_status,
       cm.body AS contact_body,
       cm.sender_name AS contact_sender_name,
       cm.sender_contact_private AS contact_sender_contact_private,
       ar.reason AS abuse_reason,
       ar.details AS abuse_details,
       ar.requester_contact_private AS abuse_requester_contact_private,
       ma.mime_type AS media_mime_type,
       ma.alt_text AS media_alt_text,
       ma.moderation_status AS media_moderation_status,
       rcr.change_type AS change_type,
       rcr.new_json AS change_new_json,
       rcr.reason AS change_reason
     FROM moderation_items mi
     LEFT JOIN tips t ON mi.entity_type = 'tip' AND t.id = mi.entity_id
     LEFT JOIN contact_messages cm ON mi.entity_type = 'contact_message' AND cm.id = mi.entity_id
     LEFT JOIN abuse_reports ar ON mi.entity_type = 'abuse_report' AND ar.id = mi.entity_id
     LEFT JOIN media_assets ma ON mi.entity_type = 'media_asset' AND ma.id = mi.entity_id
     LEFT JOIN report_change_requests rcr ON mi.entity_type = 'report_change_request' AND rcr.id = mi.entity_id
     LEFT JOIN reports tr ON tr.id = t.report_id OR tr.id = cm.report_id OR tr.id = ar.report_id OR tr.id = rcr.report_id OR (mi.entity_type = 'report' AND tr.id = mi.entity_id)
     LEFT JOIN people p ON p.id = tr.person_id
     LEFT JOIN pets pet ON pet.id = tr.pet_id
     WHERE mi.status = 'open'
     ORDER BY mi.created_at ASC
     LIMIT 100`
  ).all<DbRow>();
  return json({ items: items.results });
});

app.post("/api/admin/moderation/:itemId/approve", async (c) => {
  await ensureBootstrapUser(c.env);
  const actor = await requireActor(c.req.raw, c.env);
  if (actor instanceof Response) return actor;

  const item = await c.env.DB.prepare("SELECT * FROM moderation_items WHERE id = ?").bind(c.req.param("itemId")).first<DbRow>();
  if (!item) return badRequest("Moderation item not found.", 404);

  const entityType = String(item.entity_type);
  const entityId = String(item.entity_id);
  if (entityType === "report") {
    await c.env.DB.prepare("UPDATE reports SET moderation_status = 'published', updated_at = ? WHERE id = ?").bind(nowIso(), entityId).run();
  } else if (entityType === "tip") {
    await c.env.DB.prepare("UPDATE tips SET moderation_status = 'published' WHERE id = ?").bind(entityId).run();
  } else if (entityType === "contact_message") {
    await c.env.DB.prepare("UPDATE contact_messages SET moderation_status = 'approved', updated_at = ? WHERE id = ?").bind(nowIso(), entityId).run();
  } else if (entityType === "abuse_report") {
    await c.env.DB.prepare("UPDATE abuse_reports SET status = 'reviewed', updated_at = ? WHERE id = ?").bind(nowIso(), entityId).run();
  } else if (entityType === "volunteer") {
    await c.env.DB.prepare("UPDATE volunteers SET status = 'available', updated_at = ? WHERE id = ?").bind(nowIso(), entityId).run();
  } else if (entityType === "data_request") {
    await c.env.DB.prepare("UPDATE data_requests SET status = 'in_review', updated_at = ? WHERE id = ?").bind(nowIso(), entityId).run();
  } else if (entityType === "organization_application") {
    await approveOrganizationApplication(c.env.DB, entityId, actor);
  } else if (entityType === "report_change_request") {
    await approveReportChangeRequest(c.env.DB, entityId, actor);
  } else if (entityType === "media_asset") {
    await c.env.DB.prepare("UPDATE media_assets SET moderation_status = 'published', reviewed_by_user_id = ?, reviewed_at = ?, review_note = ? WHERE id = ?")
      .bind(actor.userId, nowIso(), "Approved from moderation queue", entityId)
      .run();
  }

  await c.env.DB.prepare("UPDATE moderation_items SET status = 'closed', updated_at = ? WHERE id = ?").bind(nowIso(), item.id).run();
  await audit(c.env.DB, {
    actorEmail: actor.email,
    action: "moderation_approved",
    entityType,
    entityId,
    before: item
  });
  return json({ ok: true });
});

app.post("/api/admin/moderation/:itemId/reject", async (c) => {
  await ensureBootstrapUser(c.env);
  const actor = await requireActor(c.req.raw, c.env);
  if (actor instanceof Response) return actor;

  const item = await c.env.DB.prepare("SELECT * FROM moderation_items WHERE id = ?").bind(c.req.param("itemId")).first<DbRow>();
  if (!item) return badRequest("Moderation item not found.", 404);

  const entityType = String(item.entity_type);
  const entityId = String(item.entity_id);
  if (entityType === "report") {
    await c.env.DB.prepare("UPDATE reports SET moderation_status = 'rejected', updated_at = ? WHERE id = ?").bind(nowIso(), entityId).run();
  } else if (entityType === "tip") {
    await c.env.DB.prepare("UPDATE tips SET moderation_status = 'rejected' WHERE id = ?").bind(entityId).run();
  } else if (entityType === "contact_message") {
    await c.env.DB.prepare("UPDATE contact_messages SET moderation_status = 'rejected', updated_at = ? WHERE id = ?").bind(nowIso(), entityId).run();
  } else if (entityType === "abuse_report") {
    await c.env.DB.prepare("UPDATE abuse_reports SET status = 'rejected', updated_at = ? WHERE id = ?").bind(nowIso(), entityId).run();
  } else if (entityType === "volunteer") {
    await c.env.DB.prepare("UPDATE volunteers SET status = 'rejected', updated_at = ? WHERE id = ?").bind(nowIso(), entityId).run();
  } else if (entityType === "data_request") {
    await c.env.DB.prepare("UPDATE data_requests SET status = 'rejected', updated_at = ? WHERE id = ?").bind(nowIso(), entityId).run();
  } else if (entityType === "organization_application") {
    await c.env.DB.prepare("UPDATE organization_applications SET status = 'rejected', updated_at = ? WHERE id = ?").bind(nowIso(), entityId).run();
  } else if (entityType === "report_change_request") {
    await c.env.DB.prepare("UPDATE report_change_requests SET status = 'rejected', reviewer_note = ?, updated_at = ? WHERE id = ?")
      .bind("Rejected from moderation queue", nowIso(), entityId)
      .run();
  } else if (entityType === "media_asset") {
    await c.env.DB.prepare("UPDATE media_assets SET moderation_status = 'rejected', reviewed_by_user_id = ?, reviewed_at = ?, review_note = ? WHERE id = ?")
      .bind(actor.userId, nowIso(), "Rejected from moderation queue", entityId)
      .run();
  }

  await c.env.DB.prepare("UPDATE moderation_items SET status = 'closed', updated_at = ? WHERE id = ?").bind(nowIso(), item.id).run();
  await audit(c.env.DB, {
    actorEmail: actor.email,
    action: "moderation_rejected",
    entityType,
    entityId,
    before: item
  });
  return json({ ok: true });
});

app.post("/api/admin/moderation/:itemId/action", async (c) => {
  await ensureBootstrapUser(c.env);
  const actor = await requireActor(c.req.raw, c.env);
  if (actor instanceof Response) return actor;

  const item = await c.env.DB.prepare("SELECT * FROM moderation_items WHERE id = ?").bind(c.req.param("itemId")).first<DbRow>();
  if (!item) return badRequest("Moderation item not found.", 404);
  const body = (await c.req.json()) as Partial<{ action: string; reason: string; reviewerNote: string; assignedToUserId: string; requestedInfo: string }>;
  const action = body.action ?? "note";
  const timestamp = nowIso();
  if (action === "request_info") {
    await c.env.DB.prepare("UPDATE moderation_items SET status = 'needs_info', requested_info = ?, reviewer_note = ?, updated_at = ? WHERE id = ?")
      .bind(body.requestedInfo ?? body.reason ?? "More information requested", body.reviewerNote ?? null, timestamp, c.req.param("itemId"))
      .run();
  } else if (action === "escalate") {
    await c.env.DB.prepare("UPDATE moderation_items SET lane = 'escalated', priority = 100, reviewer_note = ?, updated_at = ? WHERE id = ?")
      .bind(body.reason ?? body.reviewerNote ?? "Escalated for senior review", timestamp, c.req.param("itemId"))
      .run();
  } else if (action === "assign") {
    await c.env.DB.prepare("UPDATE moderation_items SET assigned_to_user_id = ?, reviewer_note = ?, updated_at = ? WHERE id = ?")
      .bind(body.assignedToUserId ?? null, body.reviewerNote ?? null, timestamp, c.req.param("itemId"))
      .run();
  } else if (action === "hide" || action === "remove") {
    await applyModerationEntityStatus(c.env.DB, item, action);
    await c.env.DB.prepare("UPDATE moderation_items SET status = 'closed', reviewer_note = ?, updated_at = ? WHERE id = ?")
      .bind(body.reason ?? null, timestamp, c.req.param("itemId"))
      .run();
  } else {
    await c.env.DB.prepare("UPDATE moderation_items SET reviewer_note = ?, updated_at = ? WHERE id = ?")
      .bind(body.reviewerNote ?? body.reason ?? null, timestamp, c.req.param("itemId"))
      .run();
  }
  await audit(c.env.DB, {
    actorEmail: actor.email,
    action: `moderation_${action}`,
    entityType: String(item.entity_type),
    entityId: String(item.entity_id),
    before: item,
    after: body,
    reason: body.reason
  });
  return json({ ok: true });
});

app.post("/api/admin/reports/:id/status", async (c) => {
  await ensureBootstrapUser(c.env);
  const actor = await requireActor(c.req.raw, c.env);
  if (actor instanceof Response) return actor;

  const body = (await c.req.json()) as { status?: ReportStatus; verificationLevel?: VerificationLevel; note?: string };
  if (!body.status) return badRequest("Status is required.");

  const existing = await c.env.DB.prepare("SELECT status FROM reports WHERE id = ?").bind(c.req.param("id")).first<{ status: string }>();
  if (!existing) return badRequest("Report not found.", 404);

  const timestamp = nowIso();
  await c.env.DB.prepare("UPDATE reports SET status = ?, verification_level = COALESCE(?, verification_level), updated_at = ? WHERE id = ?")
    .bind(body.status, body.verificationLevel ?? null, timestamp, c.req.param("id"))
    .run();
  await c.env.DB.prepare(
    `INSERT INTO status_events (id, report_id, old_status, new_status, verification_level, source_type, source_note, created_by_user_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(makeId("status"), c.req.param("id"), existing.status, body.status, body.verificationLevel ?? "unverified", "admin", body.note ?? null, actor.userId, timestamp)
    .run();
  await audit(c.env.DB, {
    actorEmail: actor.email,
    action: "report_status_changed",
    entityType: "report",
    entityId: c.req.param("id"),
    before: existing,
    after: body
  });
  return json({ ok: true });
});

app.post("/api/admin/resources", async (c) => {
  await ensureBootstrapUser(c.env);
  const actor = await requireActor(c.req.raw, c.env);
  if (actor instanceof Response) return actor;

  const body = (await c.req.json()) as Partial<{
    type: ResourceType;
    name: string;
    description: string;
    address: string;
    admin1: string;
    city: string;
    hours: string;
    capacity: string;
    availabilityStatus: string;
    contactPublic: string;
    sourceUrl: string;
    acceptedGroups: string;
    accessibility: string;
    supplies: string;
    currentNeeds: string;
    services: string;
    donationUrl: string;
    donationVerificationStatus: string;
    protectedLocation: boolean;
    verificationLevel: VerificationLevel;
    organizationId: string;
    lat: number | string;
    lng: number | string;
    locationPrecision: string;
  }>;
  if (!body.type || !body.name) return badRequest("Resource type and name are required.");
  const lat = bodyNumber(body.lat);
  const lng = bodyNumber(body.lng);
  if ((lat === null) !== (lng === null)) return badRequest("Latitude and longitude must be provided together.");
  if (!validLatLng(lat, lng)) return badRequest("Coordinates are invalid.");
  if (body.organizationId && !(await actorCanManageOrganization(c.env.DB, actor, body.organizationId))) {
    return badRequest("Insufficient organization permissions.", 403);
  }

  const id = makeId("res");
  const timestamp = nowIso();
  await c.env.DB.prepare(
    `INSERT INTO resources (
      id, type, name, description, address, admin1, city, lat, lng, location_precision, hours, capacity, availability_status,
      contact_public, source_url, accepted_groups, accessibility, supplies, current_needs, services,
      donation_url, donation_verification_status, donation_verified_at, protected_location,
      verification_level, organization_id, last_verified_at, verification_due_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      body.type,
      body.name,
      body.description ?? null,
      body.address ?? null,
      body.admin1 ?? null,
      body.city ?? null,
      lat,
      lng,
      body.locationPrecision ?? "area",
      body.hours ?? null,
      body.capacity ?? null,
      body.availabilityStatus ?? "unknown",
      body.contactPublic ?? null,
      body.sourceUrl ?? null,
      body.acceptedGroups ?? null,
      body.accessibility ?? null,
      body.supplies ?? null,
      body.currentNeeds ?? null,
      body.services ?? null,
      body.donationUrl ?? null,
      body.donationVerificationStatus ?? "none",
      body.donationVerificationStatus === "verified" ? timestamp : null,
      body.protectedLocation ? 1 : 0,
      body.verificationLevel ?? "contact_verified",
      body.organizationId ?? null,
      timestamp,
      futureIsoDays(7),
      timestamp,
      timestamp
    )
    .run();
  c.executionCtx.waitUntil(c.env.JOBS.send({ type: "index_entity", entityType: "resource", entityId: id, createdAt: timestamp }));
  await audit(c.env.DB, { actorEmail: actor.email, action: "resource_created", entityType: "resource", entityId: id, after: body });
  return json({ id }, { status: 201 });
});

app.get("/api/admin/resources", async (c) => {
  await ensureBootstrapUser(c.env);
  const actor = await requireActor(c.req.raw, c.env);
  if (actor instanceof Response) return actor;
  if (actor.role === "organization_manager") {
    const orgIds = await actorOrganizationIds(c.env.DB, actor);
    if (!orgIds.length) return json({ resources: [] });
    const placeholders = orgIds.map(() => "?").join(", ");
    const result = await c.env.DB.prepare(`SELECT * FROM resources WHERE organization_id IN (${placeholders}) ORDER BY updated_at DESC LIMIT 200`)
      .bind(...orgIds)
      .all<DbRow>();
    return json({ resources: result.results.map(rowToResource) });
  }
  const result = await c.env.DB.prepare("SELECT * FROM resources ORDER BY updated_at DESC LIMIT 200").all<DbRow>();
  return json({ resources: result.results.map(rowToResource) });
});

app.patch("/api/admin/resources/:id", async (c) => {
  await ensureBootstrapUser(c.env);
  const actor = await requireActor(c.req.raw, c.env);
  if (actor instanceof Response) return actor;

  const body = (await c.req.json()) as Partial<{
    type: ResourceType;
    name: string;
    description: string;
    address: string;
    admin1: string;
    city: string;
    hours: string;
    capacity: string;
    availabilityStatus: string;
    contactPublic: string;
    sourceUrl: string;
    acceptedGroups: string;
    accessibility: string;
    supplies: string;
    currentNeeds: string;
    services: string;
    donationUrl: string;
    donationVerificationStatus: string;
    protectedLocation: boolean;
    verificationLevel: VerificationLevel;
    organizationId: string;
    lat: number | string;
    lng: number | string;
    locationPrecision: string;
  }>;
  const existing = await c.env.DB.prepare("SELECT id, organization_id FROM resources WHERE id = ?").bind(c.req.param("id")).first<{ id: string; organization_id: string | null }>();
  if (!existing) return badRequest("Resource not found.", 404);
  if (actor.role === "organization_manager") {
    if (!existing.organization_id || !(await actorCanManageOrganization(c.env.DB, actor, existing.organization_id))) {
      return badRequest("Insufficient organization permissions.", 403);
    }
    if (body.organizationId && body.organizationId !== existing.organization_id) {
      return badRequest("Organization managers cannot transfer resources.", 403);
    }
  }
  if (body.organizationId && !(await actorCanManageOrganization(c.env.DB, actor, body.organizationId))) {
    return badRequest("Insufficient organization permissions.", 403);
  }
  const lat = bodyNumber(body.lat);
  const lng = bodyNumber(body.lng);
  if ((lat === null) !== (lng === null)) return badRequest("Latitude and longitude must be provided together.");
  if (!validLatLng(lat, lng)) return badRequest("Coordinates are invalid.");

  const timestamp = nowIso();
  await c.env.DB.prepare(
    `UPDATE resources
     SET type = COALESCE(?, type),
         name = COALESCE(?, name),
         description = COALESCE(?, description),
         address = COALESCE(?, address),
         admin1 = COALESCE(?, admin1),
         city = COALESCE(?, city),
         lat = COALESCE(?, lat),
         lng = COALESCE(?, lng),
         location_precision = COALESCE(?, location_precision),
         hours = COALESCE(?, hours),
         capacity = COALESCE(?, capacity),
         availability_status = COALESCE(?, availability_status),
         contact_public = COALESCE(?, contact_public),
         source_url = COALESCE(?, source_url),
         accepted_groups = COALESCE(?, accepted_groups),
         accessibility = COALESCE(?, accessibility),
         supplies = COALESCE(?, supplies),
         current_needs = COALESCE(?, current_needs),
         services = COALESCE(?, services),
         donation_url = COALESCE(?, donation_url),
         donation_verification_status = COALESCE(?, donation_verification_status),
         donation_verified_at = CASE WHEN ? = 'verified' THEN ? ELSE donation_verified_at END,
         protected_location = COALESCE(?, protected_location),
         verification_level = COALESCE(?, verification_level),
         organization_id = COALESCE(?, organization_id),
         last_verified_at = CASE WHEN ? IS NOT NULL THEN ? ELSE last_verified_at END,
         verification_due_at = CASE WHEN ? IS NOT NULL THEN ? ELSE verification_due_at END,
         updated_at = ?
     WHERE id = ?`
  )
    .bind(
      body.type ?? null,
      body.name ?? null,
      body.description ?? null,
      body.address ?? null,
      body.admin1 ?? null,
      body.city ?? null,
      lat,
      lng,
      body.locationPrecision ?? null,
      body.hours ?? null,
      body.capacity ?? null,
      body.availabilityStatus ?? null,
      body.contactPublic ?? null,
      body.sourceUrl ?? null,
      body.acceptedGroups ?? null,
      body.accessibility ?? null,
      body.supplies ?? null,
      body.currentNeeds ?? null,
      body.services ?? null,
      body.donationUrl ?? null,
      body.donationVerificationStatus ?? null,
      body.donationVerificationStatus ?? null,
      timestamp,
      body.protectedLocation === undefined ? null : body.protectedLocation ? 1 : 0,
      body.verificationLevel ?? null,
      body.organizationId ?? null,
      body.verificationLevel ?? null,
      timestamp,
      body.verificationLevel ?? null,
      futureIsoDays(7),
      timestamp,
      c.req.param("id")
    )
    .run();
  c.executionCtx.waitUntil(c.env.JOBS.send({ type: "index_entity", entityType: "resource", entityId: c.req.param("id"), createdAt: timestamp }));
  await audit(c.env.DB, { actorEmail: actor.email, action: "resource_updated", entityType: "resource", entityId: c.req.param("id"), after: body });
  return json({ ok: true });
});

app.get("/api/admin/emergency-contacts", async (c) => {
  await ensureBootstrapUser(c.env);
  const actor = await requireActor(c.req.raw, c.env, rolesForAdminOnly());
  if (actor instanceof Response) return actor;
  const result = await c.env.DB.prepare("SELECT id, label, contact, description, sort_order FROM emergency_contacts ORDER BY sort_order ASC, label ASC").all<DbRow>();
  return json({ contacts: result.results });
});

app.post("/api/admin/emergency-contacts", async (c) => {
  await ensureBootstrapUser(c.env);
  const actor = await requireActor(c.req.raw, c.env, rolesForAdminOnly());
  if (actor instanceof Response) return actor;
  const body = (await c.req.json()) as Partial<{ label: string; contact: string; description: string; sortOrder: number }>;
  if (!body.label || !body.contact) return badRequest("Label and contact are required.");
  const id = makeId("contact");
  const timestamp = nowIso();
  await c.env.DB.prepare(
    "INSERT INTO emergency_contacts (id, label, contact, description, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(id, body.label, body.contact, body.description ?? null, body.sortOrder ?? 0, timestamp, timestamp)
    .run();
  await audit(c.env.DB, { actorEmail: actor.email, action: "emergency_contact_created", entityType: "emergency_contact", entityId: id, after: body });
  return json({ id }, { status: 201 });
});

app.patch("/api/admin/emergency-contacts/:id", async (c) => {
  await ensureBootstrapUser(c.env);
  const actor = await requireActor(c.req.raw, c.env, rolesForAdminOnly());
  if (actor instanceof Response) return actor;
  const body = (await c.req.json()) as Partial<{ label: string; contact: string; description: string; sortOrder: number }>;
  const timestamp = nowIso();
  const result = await c.env.DB.prepare(
    `UPDATE emergency_contacts
     SET label = COALESCE(?, label),
         contact = COALESCE(?, contact),
         description = COALESCE(?, description),
         sort_order = COALESCE(?, sort_order),
         updated_at = ?
     WHERE id = ?`
  )
    .bind(body.label ?? null, body.contact ?? null, body.description ?? null, body.sortOrder ?? null, timestamp, c.req.param("id"))
    .run();
  if (!result.meta.changes) return badRequest("Emergency contact not found.", 404);
  await audit(c.env.DB, { actorEmail: actor.email, action: "emergency_contact_updated", entityType: "emergency_contact", entityId: c.req.param("id"), after: body });
  return json({ ok: true });
});

app.get("/api/admin/users", async (c) => {
  await ensureBootstrapUser(c.env);
  const actor = await requireActor(c.req.raw, c.env, rolesForAdminOnly());
  if (actor instanceof Response) return actor;
  const result = await c.env.DB.prepare("SELECT id, email, name, role, created_at, updated_at FROM users ORDER BY created_at DESC LIMIT 200").all<DbRow>();
  return json({ users: result.results.map((row) => ({
    id: String(row.id),
    email: String(row.email),
    name: typeof row.name === "string" ? row.name : null,
    role: String(row.role),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  })) });
});

app.post("/api/admin/users", async (c) => {
  await ensureBootstrapUser(c.env);
  const actor = await requireActor(c.req.raw, c.env, rolesForAdminOnly());
  if (actor instanceof Response) return actor;
  const body = (await c.req.json()) as Partial<{ email: string; name: string; role: Role }>;
  if (!body.email || !body.role || !isRole(body.role)) return badRequest("Valid email and role are required.");
  const id = makeId("user");
  const timestamp = nowIso();
  await c.env.DB.prepare(
    "INSERT INTO users (id, email, name, role, auth_provider, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(id, body.email.trim().toLowerCase(), body.name ?? null, body.role, "cloudflare_access", timestamp, timestamp)
    .run();
  await audit(c.env.DB, { actorEmail: actor.email, action: "user_created", entityType: "user", entityId: id, after: body });
  return json({ id }, { status: 201 });
});

app.patch("/api/admin/users/:id/roles", async (c) => {
  await ensureBootstrapUser(c.env);
  const actor = await requireActor(c.req.raw, c.env, rolesForAdminOnly());
  if (actor instanceof Response) return actor;
  const body = (await c.req.json()) as Partial<{ role: Role }>;
  if (!body.role || !isRole(body.role)) return badRequest("Valid role is required.");
  const timestamp = nowIso();
  const result = await c.env.DB.prepare("UPDATE users SET role = ?, updated_at = ? WHERE id = ?")
    .bind(body.role, timestamp, c.req.param("id"))
    .run();
  if (!result.meta.changes) return badRequest("User not found.", 404);
  await audit(c.env.DB, { actorEmail: actor.email, action: "user_role_changed", entityType: "user", entityId: c.req.param("id"), after: body });
  return json({ ok: true });
});

app.get("/api/admin/api-clients", async (c) => {
  await ensureBootstrapUser(c.env);
  const actor = await requireActor(c.req.raw, c.env, rolesForAdminOnly());
  if (actor instanceof Response) return actor;
  const rows = await c.env.DB.prepare("SELECT * FROM partner_api_clients ORDER BY created_at DESC LIMIT 200").all<DbRow>();
  return json({ clients: rows.results.map(rowToPartnerApiClient) });
});

app.post("/api/admin/api-clients", async (c) => {
  await ensureBootstrapUser(c.env);
  const actor = await requireActor(c.req.raw, c.env, rolesForAdminOnly());
  if (actor instanceof Response) return actor;
  const body = (await c.req.json()) as Partial<{ name: string; scopes: PartnerApiScope[] }>;
  if (!body.name) return badRequest("API client name is required.");
  const scopes = (Array.isArray(body.scopes) ? body.scopes : []).filter(isPartnerApiScope);
  if (!scopes.length) return badRequest("At least one API scope is required.");
  const id = makeId("apiclient");
  const token = `emergos_${createManageToken()}`;
  const timestamp = nowIso();
  await c.env.DB.prepare(
    `INSERT INTO partner_api_clients (id, name, token_hash, scopes_json, status, created_by_user_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, body.name, await hashValue(token), JSON.stringify(scopes), "active", actor.userId, timestamp, timestamp).run();
  const client = await c.env.DB.prepare("SELECT * FROM partner_api_clients WHERE id = ?").bind(id).first<DbRow>();
  await audit(c.env.DB, { actorEmail: actor.email, action: "partner_api_client_created", entityType: "partner_api_client", entityId: id, after: { name: body.name, scopes } });
  return json({ client: client ? rowToPartnerApiClient(client) : null, token }, { status: 201 });
});

app.post("/api/admin/api-clients/:id/revoke", async (c) => {
  await ensureBootstrapUser(c.env);
  const actor = await requireActor(c.req.raw, c.env, rolesForAdminOnly());
  if (actor instanceof Response) return actor;
  const timestamp = nowIso();
  const result = await c.env.DB.prepare("UPDATE partner_api_clients SET status = 'revoked', updated_at = ? WHERE id = ?").bind(timestamp, c.req.param("id")).run();
  if (!result.meta.changes) return badRequest("API client not found.", 404);
  await audit(c.env.DB, { actorEmail: actor.email, action: "partner_api_client_revoked", entityType: "partner_api_client", entityId: c.req.param("id") });
  return json({ ok: true });
});

app.get("/api/admin/duplicates", async (c) => {
  await ensureBootstrapUser(c.env);
  const actor = await requireActor(c.req.raw, c.env);
  if (actor instanceof Response) return actor;
  const result = await c.env.DB.prepare(
    `SELECT dc.*,
            COALESCE(p1.display_name, pet1.name) AS report_name,
            COALESCE(p2.display_name, pet2.name) AS candidate_name
     FROM duplicate_candidates dc
     LEFT JOIN reports r1 ON r1.id = dc.report_id
     LEFT JOIN people p1 ON p1.id = r1.person_id
     LEFT JOIN pets pet1 ON pet1.id = r1.pet_id
     LEFT JOIN reports r2 ON r2.id = dc.candidate_report_id
     LEFT JOIN people p2 ON p2.id = r2.person_id
     LEFT JOIN pets pet2 ON pet2.id = r2.pet_id
     WHERE dc.status = 'open'
     ORDER BY dc.score DESC, dc.created_at DESC
     LIMIT 100`
  ).all<DbRow>();
  return json({ duplicates: result.results.map(rowToDuplicateCandidate) });
});

app.post("/api/admin/reports/:id/merge", async (c) => {
  await ensureBootstrapUser(c.env);
  const actor = await requireActor(c.req.raw, c.env);
  if (actor instanceof Response) return actor;
  const body = (await c.req.json()) as { canonicalReportId?: string; reason?: string };
  if (!body.canonicalReportId || body.canonicalReportId === c.req.param("id")) return badRequest("Canonical report is required.");

  const [duplicate, canonical] = await Promise.all([
    reportSlugById(c.env.DB, c.req.param("id")),
    reportSlugById(c.env.DB, body.canonicalReportId)
  ]);
  if (!duplicate || !canonical) return badRequest("Report not found.", 404);

  const timestamp = nowIso();
  await c.env.DB.prepare(
    "UPDATE reports SET status = 'duplicate', moderation_status = 'hidden', duplicate_of_report_id = ?, updated_at = ? WHERE id = ?"
  ).bind(body.canonicalReportId, timestamp, c.req.param("id")).run();
  await c.env.DB.prepare(
    "INSERT OR REPLACE INTO report_redirects (old_slug, new_slug, report_id, created_at) VALUES (?, ?, ?, ?)"
  ).bind(duplicate.public_slug, canonical.public_slug, c.req.param("id"), timestamp).run();
  await c.env.DB.prepare(
    "UPDATE duplicate_candidates SET status = 'merged', updated_at = ? WHERE report_id = ? OR candidate_report_id = ?"
  ).bind(timestamp, c.req.param("id"), c.req.param("id")).run();
  await audit(c.env.DB, {
    actorEmail: actor.email,
    action: "report_merged",
    entityType: "report",
    entityId: c.req.param("id"),
    after: { canonicalReportId: body.canonicalReportId, reason: body.reason ?? null }
  });
  return json({ ok: true, canonicalSlug: canonical.public_slug });
});

app.post("/api/admin/reports/:id/duplicate-check", async (c) => {
  await ensureBootstrapUser(c.env);
  const actor = await requireActor(c.req.raw, c.env);
  if (actor instanceof Response) return actor;
  await c.env.JOBS.send({ type: "duplicate_check", reportId: c.req.param("id"), createdAt: nowIso() });
  await audit(c.env.DB, { actorEmail: actor.email, action: "duplicate_check_requested", entityType: "report", entityId: c.req.param("id") });
  return json({ ok: true });
});

app.post("/api/admin/reports/:id/assign-organization", async (c) => {
  await ensureBootstrapUser(c.env);
  const actor = await requireActor(c.req.raw, c.env, rolesForAdminOnly());
  if (actor instanceof Response) return actor;
  const body = (await c.req.json()) as { organizationId?: string };
  if (!body.organizationId) return badRequest("Organization is required.");
  if (!(await assertOrganizationExists(c.env.DB, body.organizationId))) return badRequest("Organization not found.", 404);
  const result = await c.env.DB.prepare("UPDATE reports SET assigned_organization_id = ?, contact_mode = 'organization_mediated', updated_at = ? WHERE id = ?")
    .bind(body.organizationId, nowIso(), c.req.param("id"))
    .run();
  if (!result.meta.changes) return badRequest("Report not found.", 404);
  await audit(c.env.DB, { actorEmail: actor.email, action: "report_assigned_organization", entityType: "report", entityId: c.req.param("id"), after: body });
  return json({ ok: true });
});

app.post("/api/admin/resources/:id/assign-organization", async (c) => {
  await ensureBootstrapUser(c.env);
  const actor = await requireActor(c.req.raw, c.env, rolesForAdminOnly());
  if (actor instanceof Response) return actor;
  const body = (await c.req.json()) as { organizationId?: string };
  if (!body.organizationId) return badRequest("Organization is required.");
  if (!(await assertOrganizationExists(c.env.DB, body.organizationId))) return badRequest("Organization not found.", 404);
  const result = await c.env.DB.prepare("UPDATE resources SET organization_id = ?, updated_at = ? WHERE id = ?")
    .bind(body.organizationId, nowIso(), c.req.param("id"))
    .run();
  if (!result.meta.changes) return badRequest("Resource not found.", 404);
  await audit(c.env.DB, { actorEmail: actor.email, action: "resource_assigned_organization", entityType: "resource", entityId: c.req.param("id"), after: body });
  return json({ ok: true });
});

app.get("/api/admin/imports", async (c) => {
  await ensureBootstrapUser(c.env);
  const actor = await requireActor(c.req.raw, c.env, rolesForAdminOnly());
  if (actor instanceof Response) return actor;
  const jobs = await c.env.DB.prepare("SELECT * FROM import_jobs ORDER BY created_at DESC LIMIT 100").all<DbRow>();
  return json({ imports: jobs.results.map(rowToImportJob) });
});

app.post("/api/admin/imports", async (c) => {
  await ensureBootstrapUser(c.env);
  const actor = await requireActor(c.req.raw, c.env, rolesForAdminOnly());
  if (actor instanceof Response) return actor;
  const form = await c.req.formData();
  const type = textField(form, "type");
  const file = form.get("file");
  if (!type || !(file instanceof File) || file.size === 0) return badRequest("Import type and CSV file are required.");
  if (file.size > 1024 * 1024) return badRequest("CSV imports must be 1 MB or smaller.", 413);

  const id = makeId("import");
  const timestamp = nowIso();
  const key = `imports/${id}.csv`;
  await c.env.MEDIA.put(key, file.stream(), { httpMetadata: { contentType: "text/csv; charset=utf-8" } });
  await c.env.DB.prepare(
    `INSERT INTO import_jobs (id, type, status, source_filename, bucket_key, created_by_user_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, type, "pending", file.name || null, key, actor.userId, timestamp, timestamp).run();
  await c.env.JOBS.send({ type: "import_csv", importJobId: id, createdAt: timestamp });
  await audit(c.env.DB, { actorEmail: actor.email, action: "import_created", entityType: "import_job", entityId: id, after: { type } });
  return json({ id }, { status: 201 });
});

app.get("/api/admin/exports", async (c) => {
  await ensureBootstrapUser(c.env);
  const actor = await requireActor(c.req.raw, c.env, rolesForAdminOnly());
  if (actor instanceof Response) return actor;
  const jobs = await c.env.DB.prepare("SELECT * FROM export_jobs ORDER BY created_at DESC LIMIT 100").all<DbRow>();
  return json({ exports: jobs.results.map(rowToExportJob) });
});

app.post("/api/admin/exports", async (c) => {
  await ensureBootstrapUser(c.env);
  const actor = await requireActor(c.req.raw, c.env, rolesForAdminOnly());
  if (actor instanceof Response) return actor;
  const body = (await c.req.json()) as { type?: string };
  if (!body.type) return badRequest("Export type is required.");
  const id = makeId("export");
  const timestamp = nowIso();
  await c.env.DB.prepare(
    "INSERT INTO export_jobs (id, type, status, created_by_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).bind(id, body.type, "pending", actor.userId, timestamp, timestamp).run();
  await c.env.JOBS.send({ type: "export_csv", exportJobId: id, createdAt: timestamp });
  await audit(c.env.DB, { actorEmail: actor.email, action: "export_created", entityType: "export_job", entityId: id, after: body });
  return json({ id }, { status: 201 });
});

app.get("/api/admin/exports/:id/download", async (c) => {
  await ensureBootstrapUser(c.env);
  const actor = await requireActor(c.req.raw, c.env, rolesForAdminOnly());
  if (actor instanceof Response) return actor;
  const job = await c.env.DB.prepare("SELECT type, bucket_key FROM export_jobs WHERE id = ? AND status = 'complete'")
    .bind(c.req.param("id"))
    .first<{ type: string; bucket_key: string }>();
  if (!job?.bucket_key) return badRequest("Export is not ready.", 404);
  const object = await c.env.MEDIA.get(job.bucket_key);
  if (!object) return badRequest("Export file not found.", 404);
  return new Response(object.body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="emergos-${job.type}.csv"`
    }
  });
});

app.get("/api/admin/generated-files", async (c) => {
  await ensureBootstrapUser(c.env);
  const actor = await requireActor(c.req.raw, c.env);
  if (actor instanceof Response) return actor;
  const result = await c.env.DB.prepare("SELECT * FROM generated_files ORDER BY created_at DESC LIMIT 200").all<DbRow>();
  return json({ files: result.results.map(rowToGeneratedFile) });
});

app.get("/api/admin/media-review", async (c) => {
  await ensureBootstrapUser(c.env);
  const actor = await requireActor(c.req.raw, c.env);
  if (actor instanceof Response) return actor;
  const rows = await c.env.DB.prepare("SELECT * FROM media_assets ORDER BY created_at DESC LIMIT 200").all<DbRow>();
  return json({ media: rows.results.map(rowToMediaReviewItem) });
});

app.post("/api/admin/generated-files", async (c) => {
  await ensureBootstrapUser(c.env);
  const actor = await requireActor(c.req.raw, c.env);
  if (actor instanceof Response) return actor;
  const body = (await c.req.json()) as Partial<{ type: string; entityType: string; entityId: string; label: string }>;
  if (!body.type) return badRequest("Generated file type is required.");
  const created = await createGeneratedFile(c.env, actor, {
    type: body.type,
    entityType: body.entityType ?? null,
    entityId: body.entityId ?? null,
    label: body.label ?? null
  });
  if ("error" in created) return created.error;
  await audit(c.env.DB, { actorEmail: actor.email, action: "generated_file_created", entityType: "generated_file", entityId: created.fileId, after: body });
  return json({ id: created.fileId }, { status: 201 });
});

app.get("/api/admin/generated-files/:id/download", async (c) => {
  await ensureBootstrapUser(c.env);
  const actor = await requireActor(c.req.raw, c.env);
  if (actor instanceof Response) return actor;
  return await generatedFileResponse(c.env, c.req.param("id"));
});

app.get("/api/admin/organizations", async (c) => {
  await ensureBootstrapUser(c.env);
  const actor = await requireActor(c.req.raw, c.env);
  if (actor instanceof Response) return actor;
  const result = await c.env.DB.prepare("SELECT * FROM organizations ORDER BY updated_at DESC LIMIT 200").all<DbRow>();
  return json({ organizations: result.results.map(rowToOrganization) });
});

app.get("/api/admin/organization-applications", async (c) => {
  await ensureBootstrapUser(c.env);
  const actor = await requireActor(c.req.raw, c.env, rolesForAdminOnly());
  if (actor instanceof Response) return actor;
  const result = await c.env.DB.prepare("SELECT * FROM organization_applications ORDER BY created_at DESC LIMIT 200").all<DbRow>();
  return json({ applications: result.results.map(rowToOrganizationApplication) });
});

app.post("/api/admin/organization-applications/:id/approve", async (c) => {
  await ensureBootstrapUser(c.env);
  const actor = await requireActor(c.req.raw, c.env, rolesForAdminOnly());
  if (actor instanceof Response) return actor;
  const organizationId = await approveOrganizationApplication(c.env.DB, c.req.param("id"), actor);
  if (!organizationId) return badRequest("Organization application not found.", 404);
  await audit(c.env.DB, { actorEmail: actor.email, action: "organization_application_approved", entityType: "organization_application", entityId: c.req.param("id"), after: { organizationId } });
  return json({ ok: true, organizationId });
});

app.post("/api/admin/organization-applications/:id/reject", async (c) => {
  await ensureBootstrapUser(c.env);
  const actor = await requireActor(c.req.raw, c.env, rolesForAdminOnly());
  if (actor instanceof Response) return actor;
  const body = (await c.req.json().catch(() => ({}))) as { reason?: string };
  const result = await c.env.DB.prepare("UPDATE organization_applications SET status = 'rejected', updated_at = ? WHERE id = ?")
    .bind(nowIso(), c.req.param("id"))
    .run();
  if (!result.meta.changes) return badRequest("Organization application not found.", 404);
  await audit(c.env.DB, { actorEmail: actor.email, action: "organization_application_rejected", entityType: "organization_application", entityId: c.req.param("id"), reason: body.reason });
  return json({ ok: true });
});

app.post("/api/admin/organizations", async (c) => {
  await ensureBootstrapUser(c.env);
  const actor = await requireActor(c.req.raw, c.env, rolesForAdminOnly());
  if (actor instanceof Response) return actor;
  const body = (await c.req.json()) as Partial<{ name: string; type: string; description: string; website: string; contactPublic: string; verificationStatus: VerificationLevel; verificationEvidence: string; onboardingStatus: string }>;
  if (!body.name || !body.type) return badRequest("Organization name and type are required.");
  const id = makeId("org");
  const timestamp = nowIso();
  await c.env.DB.prepare(
    `INSERT INTO organizations (
      id, name, type, description, website, contact_public, verification_status, verification_evidence, onboarding_status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, body.name, body.type, body.description ?? null, body.website ?? null, body.contactPublic ?? null, body.verificationStatus ?? "contact_verified", body.verificationEvidence ?? null, body.onboardingStatus ?? "approved", timestamp, timestamp).run();
  await audit(c.env.DB, { actorEmail: actor.email, action: "organization_created", entityType: "organization", entityId: id, after: body });
  return json({ id }, { status: 201 });
});

app.patch("/api/admin/organizations/:id", async (c) => {
  await ensureBootstrapUser(c.env);
  const actor = await requireActor(c.req.raw, c.env, rolesForAdminOnly());
  if (actor instanceof Response) return actor;
  const body = (await c.req.json()) as Partial<{ name: string; type: string; description: string; website: string; contactPublic: string; verificationStatus: VerificationLevel; verificationEvidence: string; onboardingStatus: string }>;
  const timestamp = nowIso();
  const result = await c.env.DB.prepare(
    `UPDATE organizations
     SET name = COALESCE(?, name), type = COALESCE(?, type), description = COALESCE(?, description),
         website = COALESCE(?, website), contact_public = COALESCE(?, contact_public),
         verification_status = COALESCE(?, verification_status),
         verification_evidence = COALESCE(?, verification_evidence),
         onboarding_status = COALESCE(?, onboarding_status),
         updated_at = ?
     WHERE id = ?`
  ).bind(body.name ?? null, body.type ?? null, body.description ?? null, body.website ?? null, body.contactPublic ?? null, body.verificationStatus ?? null, body.verificationEvidence ?? null, body.onboardingStatus ?? null, timestamp, c.req.param("id")).run();
  if (!result.meta.changes) return badRequest("Organization not found.", 404);
  await audit(c.env.DB, { actorEmail: actor.email, action: "organization_updated", entityType: "organization", entityId: c.req.param("id"), after: body });
  return json({ ok: true });
});

app.get("/api/admin/organization-dashboard", async (c) => {
  await ensureBootstrapUser(c.env);
  const actor = await requireActor(c.req.raw, c.env);
  if (actor instanceof Response) return actor;
  const orgIds = actor.role === "organization_manager" ? await actorOrganizationIds(c.env.DB, actor) : [];
  const scope = actor.role === "organization_manager" ? orgIds : null;
  if (scope && !scope.length) return json({ organizations: [], reports: [], resources: [], volunteers: [] });

  const orgWhere = scope ? `WHERE id IN (${scope.map(() => "?").join(", ")})` : "";
  const orgs = await c.env.DB.prepare(`SELECT * FROM organizations ${orgWhere} ORDER BY updated_at DESC LIMIT 200`)
    .bind(...(scope ?? []))
    .all<DbRow>();

  const reportWhere = scope ? `WHERE r.assigned_organization_id IN (${scope.map(() => "?").join(", ")})` : "";
  const reports = await c.env.DB.prepare(
    `SELECT
       r.*,
       COALESCE(p.display_name, pet.name) AS display_name,
       p.age AS age,
       COALESCE(p.age_range, pet.species) AS age_range,
       COALESCE(p.description, pet.notes_public, pet.markings) AS description
     FROM reports r
     LEFT JOIN people p ON p.id = r.person_id
     LEFT JOIN pets pet ON pet.id = r.pet_id
     ${reportWhere}
     ORDER BY r.updated_at DESC
     LIMIT 200`
  ).bind(...(scope ?? [])).all<DbRow>();

  const resourceWhere = scope ? `WHERE organization_id IN (${scope.map(() => "?").join(", ")})` : "";
  const resources = await c.env.DB.prepare(`SELECT * FROM resources ${resourceWhere} ORDER BY updated_at DESC LIMIT 200`)
    .bind(...(scope ?? []))
    .all<DbRow>();

  const volunteerWhere = scope ? `WHERE assigned_organization_id IN (${scope.map(() => "?").join(", ")})` : "";
  const volunteers = await c.env.DB.prepare(
    `SELECT id, name, location, skills, languages, availability, status, assigned_organization_id, created_at, updated_at
     FROM volunteers ${volunteerWhere}
     ORDER BY created_at DESC
     LIMIT 200`
  ).bind(...(scope ?? [])).all<DbRow>();

  return json({
    organizations: orgs.results.map(rowToOrganization),
    reports: reports.results.map(rowToReport),
    resources: resources.results.map(rowToResource),
    volunteers: volunteers.results.map(rowToVolunteer)
  });
});

app.get("/api/org/dashboard", async (c) => {
  await ensureBootstrapUser(c.env);
  const actor = await requireActor(c.req.raw, c.env);
  if (actor instanceof Response) return actor;
  if (actor.role !== "organization_manager" && actor.role !== "owner" && actor.role !== "admin") return badRequest("Organization access is required.", 403);
  const orgIds = await actorOrganizationIds(c.env.DB, actor);
  if (!orgIds.length && actor.role === "organization_manager") return json({ organizations: [], reports: [], resources: [], volunteers: [] });
  const scope = orgIds.length ? orgIds : null;
  const placeholders = scope ? scope.map(() => "?").join(", ") : "";
  const orgs = await c.env.DB.prepare(`SELECT * FROM organizations ${scope ? `WHERE id IN (${placeholders})` : ""} ORDER BY updated_at DESC LIMIT 50`)
    .bind(...(scope ?? []))
    .all<DbRow>();
  const reports = await c.env.DB.prepare(
    `SELECT r.*, COALESCE(p.display_name, pet.name) AS display_name, p.age AS age,
            COALESCE(p.age_range, pet.species) AS age_range,
            COALESCE(p.description, pet.notes_public, pet.markings) AS description,
            pet.name AS pet_name, pet.species AS pet_species, pet.breed AS pet_breed,
            pet.color AS pet_color, pet.markings AS pet_markings
     FROM reports r
     LEFT JOIN people p ON p.id = r.person_id
     LEFT JOIN pets pet ON pet.id = r.pet_id
     ${scope ? `WHERE r.assigned_organization_id IN (${placeholders})` : ""}
     ORDER BY r.updated_at DESC LIMIT 100`
  ).bind(...(scope ?? [])).all<DbRow>();
  const resources = await c.env.DB.prepare(`SELECT * FROM resources ${scope ? `WHERE organization_id IN (${placeholders})` : ""} ORDER BY updated_at DESC LIMIT 100`)
    .bind(...(scope ?? []))
    .all<DbRow>();
  const volunteers = await c.env.DB.prepare(
    `SELECT id, name, location, skills, languages, availability, status, assigned_organization_id, created_at, updated_at
     FROM volunteers ${scope ? `WHERE assigned_organization_id IN (${placeholders})` : ""}
     ORDER BY updated_at DESC LIMIT 100`
  ).bind(...(scope ?? [])).all<DbRow>();
  return json({
    organizations: orgs.results.map(rowToOrganization),
    reports: reports.results.map(rowToReport),
    resources: resources.results.map(rowToResource),
    volunteers: volunteers.results.map(rowToVolunteer)
  });
});

app.patch("/api/org/profile/:id", async (c) => {
  await ensureBootstrapUser(c.env);
  const actor = await requireActor(c.req.raw, c.env);
  if (actor instanceof Response) return actor;
  const organizationId = c.req.param("id");
  if (!(await actorCanManageOrganization(c.env.DB, actor, organizationId))) return badRequest("Insufficient organization permissions.", 403);
  const body = (await c.req.json()) as Partial<{ description: string; website: string; contactPublic: string }>;
  const timestamp = nowIso();
  await c.env.DB.prepare(
    "UPDATE organizations SET description = COALESCE(?, description), website = COALESCE(?, website), contact_public = COALESCE(?, contact_public), updated_at = ? WHERE id = ?"
  ).bind(body.description ?? null, body.website ?? null, body.contactPublic ?? null, timestamp, organizationId).run();
  await audit(c.env.DB, { actorEmail: actor.email, action: "organization_profile_updated", entityType: "organization", entityId: organizationId, after: body });
  return json({ ok: true });
});

app.get("/api/admin/organization-memberships", async (c) => {
  await ensureBootstrapUser(c.env);
  const actor = await requireActor(c.req.raw, c.env, rolesForAdminOnly());
  if (actor instanceof Response) return actor;
  const rows = await c.env.DB.prepare(
    `SELECT om.*, o.name AS organization_name, u.email AS user_email
     FROM organization_memberships om
     LEFT JOIN organizations o ON o.id = om.organization_id
     LEFT JOIN users u ON u.id = om.user_id
     ORDER BY om.updated_at DESC
     LIMIT 300`
  ).all<DbRow>();
  return json({ memberships: rows.results.map(rowToOrganizationMembership) });
});

app.post("/api/admin/organization-memberships", async (c) => {
  await ensureBootstrapUser(c.env);
  const actor = await requireActor(c.req.raw, c.env, rolesForAdminOnly());
  if (actor instanceof Response) return actor;
  const body = (await c.req.json()) as Partial<{ organizationId: string; userId: string; role: string }>;
  if (!body.organizationId || !body.userId) return badRequest("Organization and user are required.");
  if (!(await assertOrganizationExists(c.env.DB, body.organizationId))) return badRequest("Organization not found.", 404);
  const user = await c.env.DB.prepare("SELECT id FROM users WHERE id = ?").bind(body.userId).first<{ id: string }>();
  if (!user) return badRequest("User not found.", 404);
  const id = makeId("orgmem");
  const timestamp = nowIso();
  await c.env.DB.prepare(
    `INSERT INTO organization_memberships (id, organization_id, user_id, role, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(organization_id, user_id) DO UPDATE SET role = excluded.role, updated_at = excluded.updated_at`
  ).bind(id, body.organizationId, body.userId, body.role ?? "organization_manager", timestamp, timestamp).run();
  await audit(c.env.DB, { actorEmail: actor.email, action: "organization_membership_saved", entityType: "organization_membership", entityId: id, after: body });
  return json({ id }, { status: 201 });
});

app.delete("/api/admin/organization-memberships/:id", async (c) => {
  await ensureBootstrapUser(c.env);
  const actor = await requireActor(c.req.raw, c.env, rolesForAdminOnly());
  if (actor instanceof Response) return actor;
  const existing = await c.env.DB.prepare("SELECT * FROM organization_memberships WHERE id = ?").bind(c.req.param("id")).first<DbRow>();
  if (!existing) return badRequest("Membership not found.", 404);
  await c.env.DB.prepare("DELETE FROM organization_memberships WHERE id = ?").bind(c.req.param("id")).run();
  await audit(c.env.DB, { actorEmail: actor.email, action: "organization_membership_deleted", entityType: "organization_membership", entityId: c.req.param("id"), before: existing });
  return json({ ok: true });
});

app.get("/api/admin/volunteers", async (c) => {
  await ensureBootstrapUser(c.env);
  const actor = await requireActor(c.req.raw, c.env);
  if (actor instanceof Response) return actor;
  if (actor.role === "organization_manager") {
    const orgIds = await actorOrganizationIds(c.env.DB, actor);
    if (!orgIds.length) return json({ volunteers: [] });
    const result = await c.env.DB.prepare(
      `SELECT id, name, location, skills, languages, availability, status, assigned_organization_id, created_at, updated_at
       FROM volunteers
       WHERE assigned_organization_id IN (${orgIds.map(() => "?").join(", ")})
       ORDER BY created_at DESC
       LIMIT 200`
    ).bind(...orgIds).all<DbRow>();
    return json({ volunteers: result.results.map(rowToVolunteer) });
  }
  const result = await c.env.DB.prepare("SELECT id, name, location, skills, languages, availability, status, assigned_organization_id, created_at, updated_at FROM volunteers ORDER BY created_at DESC LIMIT 200").all<DbRow>();
  return json({ volunteers: result.results.map(rowToVolunteer) });
});

app.patch("/api/admin/volunteers/:id", async (c) => {
  await ensureBootstrapUser(c.env);
  const actor = await requireActor(c.req.raw, c.env);
  if (actor instanceof Response) return actor;
  const body = (await c.req.json()) as Partial<{ status: string; assignedOrganizationId: string; notesPrivate: string }>;
  const existing = await c.env.DB.prepare("SELECT assigned_organization_id FROM volunteers WHERE id = ?").bind(c.req.param("id")).first<{ assigned_organization_id: string | null }>();
  if (!existing) return badRequest("Volunteer not found.", 404);
  if (actor.role === "organization_manager") {
    if (!existing.assigned_organization_id || !(await actorCanManageOrganization(c.env.DB, actor, existing.assigned_organization_id))) {
      return badRequest("Insufficient organization permissions.", 403);
    }
    if (body.assignedOrganizationId && body.assignedOrganizationId !== existing.assigned_organization_id) {
      return badRequest("Organization managers cannot transfer volunteers.", 403);
    }
  }
  if (body.assignedOrganizationId && !(await actorCanManageOrganization(c.env.DB, actor, body.assignedOrganizationId))) {
    return badRequest("Insufficient organization permissions.", 403);
  }
  const timestamp = nowIso();
  const result = await c.env.DB.prepare(
    "UPDATE volunteers SET status = COALESCE(?, status), assigned_organization_id = COALESCE(?, assigned_organization_id), notes_private = COALESCE(?, notes_private), updated_at = ? WHERE id = ?"
  ).bind(body.status ?? null, body.assignedOrganizationId ?? null, body.notesPrivate ?? null, timestamp, c.req.param("id")).run();
  if (!result.meta.changes) return badRequest("Volunteer not found.", 404);
  await audit(c.env.DB, { actorEmail: actor.email, action: "volunteer_updated", entityType: "volunteer", entityId: c.req.param("id"), after: body });
  return json({ ok: true });
});

app.get("/api/admin/volunteer-assignments", async (c) => {
  await ensureBootstrapUser(c.env);
  const actor = await requireActor(c.req.raw, c.env);
  if (actor instanceof Response) return actor;
  const orgIds = actor.role === "organization_manager" ? await actorOrganizationIds(c.env.DB, actor) : null;
  if (orgIds && !orgIds.length) return json({ assignments: [] });
  const where = orgIds ? `WHERE organization_id IN (${orgIds.map(() => "?").join(", ")})` : "";
  const rows = await c.env.DB.prepare(`SELECT * FROM volunteer_assignments ${where} ORDER BY updated_at DESC LIMIT 300`)
    .bind(...(orgIds ?? []))
    .all<DbRow>();
  return json({ assignments: rows.results.map(rowToVolunteerAssignment) });
});

app.post("/api/admin/volunteer-assignments", async (c) => {
  await ensureBootstrapUser(c.env);
  const actor = await requireActor(c.req.raw, c.env);
  if (actor instanceof Response) return actor;
  const body = (await c.req.json()) as Partial<{ volunteerId: string; organizationId: string; taskLabel: string; status: string; notesPrivate: string }>;
  if (!body.volunteerId || !body.taskLabel) return badRequest("Volunteer and task are required.");
  if (body.organizationId && !(await actorCanManageOrganization(c.env.DB, actor, body.organizationId))) {
    return badRequest("Insufficient organization permissions.", 403);
  }
  const id = makeId("vassign");
  const timestamp = nowIso();
  await c.env.DB.prepare(
    `INSERT INTO volunteer_assignments (
      id, volunteer_id, organization_id, task_label, status, notes_private, created_by_user_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, body.volunteerId, body.organizationId ?? null, body.taskLabel, body.status ?? "assigned", body.notesPrivate ?? null, actor.userId, timestamp, timestamp).run();
  if (body.organizationId) {
    await c.env.DB.prepare("UPDATE volunteers SET assigned_organization_id = ?, status = 'assigned', updated_at = ? WHERE id = ?")
      .bind(body.organizationId, timestamp, body.volunteerId)
      .run();
  }
  await audit(c.env.DB, { actorEmail: actor.email, action: "volunteer_assignment_created", entityType: "volunteer_assignment", entityId: id, after: body });
  return json({ id }, { status: 201 });
});

app.patch("/api/admin/volunteer-assignments/:id", async (c) => {
  await ensureBootstrapUser(c.env);
  const actor = await requireActor(c.req.raw, c.env);
  if (actor instanceof Response) return actor;
  const body = (await c.req.json()) as Partial<{ status: string; notesPrivate: string; taskLabel: string }>;
  const timestamp = nowIso();
  const result = await c.env.DB.prepare(
    "UPDATE volunteer_assignments SET status = COALESCE(?, status), notes_private = COALESCE(?, notes_private), task_label = COALESCE(?, task_label), updated_at = ? WHERE id = ?"
  ).bind(body.status ?? null, body.notesPrivate ?? null, body.taskLabel ?? null, timestamp, c.req.param("id")).run();
  if (!result.meta.changes) return badRequest("Volunteer assignment not found.", 404);
  await audit(c.env.DB, { actorEmail: actor.email, action: "volunteer_assignment_updated", entityType: "volunteer_assignment", entityId: c.req.param("id"), after: body });
  return json({ ok: true });
});

app.post("/api/admin/updates", async (c) => {
  await ensureBootstrapUser(c.env);
  const actor = await requireActor(c.req.raw, c.env, rolesForAdminOnly());
  if (actor instanceof Response) return actor;
  const body = (await c.req.json()) as Partial<{ title: string; body: string; type: string; source: string; verificationLevel: VerificationLevel; locale: string; pinned: boolean }>;
  if (!body.title || !body.body) return badRequest("Title and body are required.");
  const id = makeId("update");
  const timestamp = nowIso();
  await c.env.DB.prepare(
    "INSERT INTO public_updates (id, title, body, type, source, verification_level, locale, pinned, published_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(id, body.title, body.body, body.type ?? "situation_update", body.source ?? null, body.verificationLevel ?? "contact_verified", body.locale ?? "en", body.pinned ? 1 : 0, timestamp, timestamp, timestamp).run();
  await audit(c.env.DB, { actorEmail: actor.email, action: "public_update_created", entityType: "public_update", entityId: id, after: body });
  return json({ id }, { status: 201 });
});

app.patch("/api/admin/updates/:id", async (c) => {
  await ensureBootstrapUser(c.env);
  const actor = await requireActor(c.req.raw, c.env, rolesForAdminOnly());
  if (actor instanceof Response) return actor;
  const body = (await c.req.json()) as Partial<{ title: string; body: string; type: string; source: string; verificationLevel: VerificationLevel; locale: string; pinned: boolean }>;
  const timestamp = nowIso();
  const result = await c.env.DB.prepare(
    `UPDATE public_updates
     SET title = COALESCE(?, title), body = COALESCE(?, body), type = COALESCE(?, type),
         source = COALESCE(?, source), verification_level = COALESCE(?, verification_level),
         locale = COALESCE(?, locale), pinned = COALESCE(?, pinned), updated_at = ?
     WHERE id = ?`
  ).bind(body.title ?? null, body.body ?? null, body.type ?? null, body.source ?? null, body.verificationLevel ?? null, body.locale ?? null, body.pinned === undefined ? null : body.pinned ? 1 : 0, timestamp, c.req.param("id")).run();
  if (!result.meta.changes) return badRequest("Public update not found.", 404);
  await audit(c.env.DB, { actorEmail: actor.email, action: "public_update_updated", entityType: "public_update", entityId: c.req.param("id"), after: body });
  return json({ ok: true });
});

app.get("/api/admin/data-requests", async (c) => {
  await ensureBootstrapUser(c.env);
  const actor = await requireActor(c.req.raw, c.env, rolesForAdminOnly());
  if (actor instanceof Response) return actor;
  const result = await c.env.DB.prepare("SELECT * FROM data_requests ORDER BY created_at DESC LIMIT 200").all<DbRow>();
  return json({ dataRequests: result.results.map(rowToDataRequest) });
});

app.patch("/api/admin/data-requests/:id", async (c) => {
  await ensureBootstrapUser(c.env);
  const actor = await requireActor(c.req.raw, c.env, rolesForAdminOnly());
  if (actor instanceof Response) return actor;
  const body = (await c.req.json()) as Partial<{ status: string }>;
  const timestamp = nowIso();
  const result = await c.env.DB.prepare("UPDATE data_requests SET status = COALESCE(?, status), updated_at = ? WHERE id = ?")
    .bind(body.status ?? null, timestamp, c.req.param("id"))
    .run();
  if (!result.meta.changes) return badRequest("Data request not found.", 404);
  await audit(c.env.DB, { actorEmail: actor.email, action: "data_request_updated", entityType: "data_request", entityId: c.req.param("id"), after: body });
  return json({ ok: true });
});

app.post("/api/admin/data-requests/:id/generate-export", async (c) => {
  await ensureBootstrapUser(c.env);
  const actor = await requireActor(c.req.raw, c.env, rolesForAdminOnly());
  if (actor instanceof Response) return actor;
  const request = await c.env.DB.prepare("SELECT * FROM data_requests WHERE id = ?").bind(c.req.param("id")).first<DbRow>();
  if (!request) return badRequest("Data request not found.", 404);
  const fileId = makeId("file");
  const timestamp = nowIso();
  const payload = await buildDataRequestExport(c.env.DB, request);
  const key = `generated/data-requests/${fileId}.json`;
  await c.env.MEDIA.put(key, JSON.stringify(payload, null, 2), { httpMetadata: { contentType: "application/json; charset=utf-8" } });
  await c.env.DB.prepare(
    `INSERT INTO generated_files (id, type, entity_type, entity_id, bucket_key, mime_type, size_bytes, created_by_user_id, created_at, status, label)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(fileId, "data_request_export", "data_request", c.req.param("id"), key, "application/json; charset=utf-8", byteLength(JSON.stringify(payload, null, 2)), actor.userId, timestamp, "complete", "Privacy request export").run();
  await c.env.DB.prepare("UPDATE data_requests SET result_bucket_key = ?, status = 'fulfilled', updated_at = ? WHERE id = ?")
    .bind(key, timestamp, c.req.param("id"))
    .run();
  await audit(c.env.DB, { actorEmail: actor.email, action: "data_request_export_generated", entityType: "data_request", entityId: c.req.param("id"), after: { fileId } });
  return json({ ok: true, fileId });
});

app.get("/api/admin/data-requests/:id/download", async (c) => {
  await ensureBootstrapUser(c.env);
  const actor = await requireActor(c.req.raw, c.env, rolesForAdminOnly());
  if (actor instanceof Response) return actor;
  const request = await c.env.DB.prepare("SELECT result_bucket_key FROM data_requests WHERE id = ?").bind(c.req.param("id")).first<{ result_bucket_key: string | null }>();
  if (!request?.result_bucket_key) return badRequest("Data request export is not ready.", 404);
  const object = await c.env.MEDIA.get(request.result_bucket_key);
  if (!object) return badRequest("Data request export not found.", 404);
  return new Response(object.body, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="emergos-data-request-${c.req.param("id")}.json"`
    }
  });
});

app.get("/api/admin/inbound-emails", async (c) => {
  await ensureBootstrapUser(c.env);
  const actor = await requireActor(c.req.raw, c.env);
  if (actor instanceof Response) return actor;
  const result = await c.env.DB.prepare(
    "SELECT id, from_email, to_email, subject, related_report_id, created_tip_id, status, created_at FROM inbound_emails ORDER BY created_at DESC LIMIT 200"
  ).all<DbRow>();
  return json({ emails: result.results.map(rowToInboundEmail) });
});

app.get("/api/admin/retention-policy", async (c) => {
  await ensureBootstrapUser(c.env);
  const actor = await requireActor(c.req.raw, c.env, rolesForAdminOnly());
  if (actor instanceof Response) return actor;
  return json({ policy: await readRetentionPolicy(c.env.DB) });
});

app.patch("/api/admin/retention-policy", async (c) => {
  await ensureBootstrapUser(c.env);
  const actor = await requireActor(c.req.raw, c.env, rolesForAdminOnly());
  if (actor instanceof Response) return actor;
  const body = (await c.req.json()) as Partial<{
    tipsDaysAfterClosure: number;
    auditLogDays: number;
    volunteerDaysAfterCrisis: number;
    enabled: boolean;
  }>;
  const current = await readRetentionPolicy(c.env.DB);
  const next = {
    tipsDaysAfterClosure: saneRetentionDays(body.tipsDaysAfterClosure, current.tipsDaysAfterClosure),
    auditLogDays: saneRetentionDays(body.auditLogDays, current.auditLogDays),
    volunteerDaysAfterCrisis: saneRetentionDays(body.volunteerDaysAfterCrisis, current.volunteerDaysAfterCrisis),
    enabled: body.enabled ?? current.enabled
  };
  const timestamp = nowIso();
  await c.env.DB.prepare(
    `UPDATE retention_policies
     SET tips_days_after_closure = ?, audit_log_days = ?, volunteer_days_after_crisis = ?, enabled = ?, updated_at = ?
     WHERE id = 'default-retention-policy'`
  ).bind(next.tipsDaysAfterClosure, next.auditLogDays, next.volunteerDaysAfterCrisis, next.enabled ? 1 : 0, timestamp).run();
  await audit(c.env.DB, { actorEmail: actor.email, action: "retention_policy_updated", entityType: "retention_policy", entityId: "default-retention-policy", before: current, after: next });
  return json({ ok: true });
});

app.patch("/api/admin/settings/crisis-mode", async (c) => {
  await ensureBootstrapUser(c.env);
  const actor = await requireActor(c.req.raw, c.env, rolesForAdminOnly());
  if (actor instanceof Response) return actor;
  const body = (await c.req.json()) as Partial<{ enabled: boolean; disableMaps: boolean; preferLists: boolean; imageLight: boolean }>;
  const value = {
    enabled: Boolean(body.enabled),
    disableMaps: Boolean(body.disableMaps),
    preferLists: Boolean(body.preferLists),
    imageLight: Boolean(body.imageLight)
  };
  const timestamp = nowIso();
  await c.env.DB.prepare(
    "INSERT OR REPLACE INTO runtime_settings (key, value_json, updated_at) VALUES ('crisis_mode', ?, ?)"
  ).bind(JSON.stringify(value), timestamp).run();
  await c.env.CONFIG_KV.delete("public-config").catch(() => undefined);
  await audit(c.env.DB, { actorEmail: actor.email, action: "crisis_mode_updated", entityType: "runtime_setting", entityId: "crisis_mode", after: value });
  return json({ ok: true });
});

app.patch("/api/admin/settings/modules", async (c) => {
  await ensureBootstrapUser(c.env);
  const actor = await requireActor(c.req.raw, c.env, rolesForAdminOnly());
  if (actor instanceof Response) return actor;
  const body = (await c.req.json()) as Record<string, unknown>;
  const value = Object.fromEntries(Object.entries(body).filter(([, enabled]) => typeof enabled === "boolean")) as Record<string, boolean>;
  if (!Object.keys(value).length) return badRequest("At least one module flag is required.");
  const timestamp = nowIso();
  await c.env.DB.prepare(
    "INSERT OR REPLACE INTO runtime_settings (key, value_json, updated_at) VALUES ('modules', ?, ?)"
  ).bind(JSON.stringify(value), timestamp).run();
  await c.env.CONFIG_KV.delete("public-config").catch(() => undefined);
  await audit(c.env.DB, { actorEmail: actor.email, action: "modules_updated", entityType: "runtime_setting", entityId: "modules", after: value });
  return json({ ok: true });
});

app.post("/api/admin/retention/preview", async (c) => {
  await ensureBootstrapUser(c.env);
  const actor = await requireActor(c.req.raw, c.env, rolesForAdminOnly());
  if (actor instanceof Response) return actor;
  return json({ preview: await retentionPreview(c.env.DB) });
});

app.post("/api/admin/retention/run", async (c) => {
  await ensureBootstrapUser(c.env);
  const actor = await requireActor(c.req.raw, c.env, rolesForAdminOnly());
  if (actor instanceof Response) return actor;
  const policy = await readRetentionPolicy(c.env.DB);
  const preview = await retentionPreview(c.env.DB, policy);
  if (!policy.enabled) return json({ preview, skipped: "Retention policy is disabled." });
  await c.env.DB.prepare("DELETE FROM tips WHERE created_at < datetime('now', ?)").bind(`-${policy.tipsDaysAfterClosure} days`).run();
  await c.env.DB.prepare("DELETE FROM audit_logs WHERE created_at < datetime('now', ?)").bind(`-${policy.auditLogDays} days`).run();
  await c.env.DB.prepare("UPDATE volunteers SET status = 'consent_expired', updated_at = ? WHERE created_at < datetime('now', ?) AND status != 'consent_expired'")
    .bind(nowIso(), `-${policy.volunteerDaysAfterCrisis} days`)
    .run();
  await audit(c.env.DB, { actorEmail: actor.email, action: "retention_run", entityType: "retention_policy", entityId: "default-retention-policy", after: preview });
  return json({ preview });
});

app.get("/api/admin/notifications", async (c) => {
  await ensureBootstrapUser(c.env);
  const actor = await requireActor(c.req.raw, c.env, rolesForAdminOnly());
  if (actor instanceof Response) return actor;
  const rows = await c.env.DB.prepare("SELECT * FROM notification_events ORDER BY created_at DESC LIMIT 200").all<DbRow>();
  return json({ notifications: rows.results.map(rowToNotificationEvent) });
});

app.post("/api/admin/notifications/test", async (c) => {
  await ensureBootstrapUser(c.env);
  const actor = await requireActor(c.req.raw, c.env, rolesForAdminOnly());
  if (actor instanceof Response) return actor;
  const body = (await c.req.json()) as Partial<{ channel: string; recipient: string; templateKey: string; message: string }>;
  if (!body.channel || !body.recipient) return badRequest("Channel and recipient are required.");
  const id = await createNotificationEvent(c.env.DB, {
    channel: body.channel,
    recipient: body.recipient,
    templateKey: body.templateKey ?? "admin_test",
    payload: { message: body.message ?? "emergOS test notification" },
    userId: actor.userId
  });
  await c.env.JOBS.send({ type: "send_notification", notificationId: id, createdAt: nowIso() });
  await audit(c.env.DB, { actorEmail: actor.email, action: "notification_test_created", entityType: "notification_event", entityId: id, after: body });
  return json({ id }, { status: 201 });
});

app.post("/api/admin/notifications/:id/process", async (c) => {
  await ensureBootstrapUser(c.env);
  const actor = await requireActor(c.req.raw, c.env, rolesForAdminOnly());
  if (actor instanceof Response) return actor;
  await sendNotification(c.env, c.req.param("id"));
  await audit(c.env.DB, { actorEmail: actor.email, action: "notification_processed", entityType: "notification_event", entityId: c.req.param("id") });
  return json({ ok: true });
});

app.post("/api/admin/notifications/:id/cancel", async (c) => {
  await ensureBootstrapUser(c.env);
  const actor = await requireActor(c.req.raw, c.env, rolesForAdminOnly());
  if (actor instanceof Response) return actor;
  const result = await c.env.DB.prepare("UPDATE notification_events SET status = 'cancelled', updated_at = ? WHERE id = ?")
    .bind(nowIso(), c.req.param("id"))
    .run();
  if (!result.meta.changes) return badRequest("Notification not found.", 404);
  await audit(c.env.DB, { actorEmail: actor.email, action: "notification_cancelled", entityType: "notification_event", entityId: c.req.param("id") });
  return json({ ok: true });
});

app.get("/api/admin/workflows", async (c) => {
  await ensureBootstrapUser(c.env);
  const actor = await requireActor(c.req.raw, c.env, rolesForAdminOnly());
  if (actor instanceof Response) return actor;
  const rows = await c.env.DB.prepare("SELECT * FROM workflow_runs ORDER BY created_at DESC LIMIT 200").all<DbRow>();
  return json({ workflows: rows.results.map(rowToWorkflowRun) });
});

app.post("/api/admin/workflows", async (c) => {
  await ensureBootstrapUser(c.env);
  const actor = await requireActor(c.req.raw, c.env, rolesForAdminOnly());
  if (actor instanceof Response) return actor;
  const body = (await c.req.json()) as Partial<{ type: string; entityType: string; entityId: string }>;
  if (!body.type) return badRequest("Workflow type is required.");
  const id = makeId("workflow");
  const timestamp = nowIso();
  await c.env.DB.prepare(
    `INSERT INTO workflow_runs (id, type, entity_type, entity_id, status, step, payload_json, created_by_user_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, body.type, body.entityType ?? null, body.entityId ?? null, "queued", "queued", JSON.stringify(body), actor.userId, timestamp, timestamp).run();
  await c.env.JOBS.send({ type: "run_workflow", workflowRunId: id, createdAt: timestamp });
  await audit(c.env.DB, { actorEmail: actor.email, action: "workflow_started", entityType: "workflow_run", entityId: id, after: body });
  return json({ id }, { status: 201 });
});

app.get("/api/admin/geodata/imports", async (c) => {
  await ensureBootstrapUser(c.env);
  const actor = await requireActor(c.req.raw, c.env, rolesForAdminOnly());
  if (actor instanceof Response) return actor;
  const rows = await c.env.DB.prepare("SELECT * FROM geodata_imports ORDER BY created_at DESC LIMIT 100").all<DbRow>();
  return json({ imports: rows.results.map(rowToGeodataImport) });
});

app.post("/api/admin/geodata/imports", async (c) => {
  await ensureBootstrapUser(c.env);
  const actor = await requireActor(c.req.raw, c.env, rolesForAdminOnly());
  if (actor instanceof Response) return actor;
  const form = await c.req.formData();
  const type = textField(form, "type") ?? "resources_geojson";
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return badRequest("GeoJSON file is required.");
  if (file.size > 3 * 1024 * 1024) return badRequest("GeoJSON imports must be 3 MB or smaller.", 413);
  const id = makeId("geoimp");
  const timestamp = nowIso();
  const key = `geodata/${id}.geojson`;
  await c.env.MEDIA.put(key, file.stream(), { httpMetadata: { contentType: file.type || "application/geo+json" } });
  await c.env.DB.prepare(
    `INSERT INTO geodata_imports (id, type, status, source_filename, bucket_key, created_by_user_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, type, "pending", file.name || null, key, actor.userId, timestamp, timestamp).run();
  await c.env.JOBS.send({ type: "import_geodata", geodataImportId: id, createdAt: timestamp });
  await audit(c.env.DB, { actorEmail: actor.email, action: "geodata_import_created", entityType: "geodata_import", entityId: id, after: { type } });
  return json({ id }, { status: 201 });
});

app.get("/api/admin/map-layers", async (c) => {
  await ensureBootstrapUser(c.env);
  const actor = await requireActor(c.req.raw, c.env, rolesForAdminOnly());
  if (actor instanceof Response) return actor;
  const rows = await c.env.DB.prepare("SELECT * FROM map_layers ORDER BY updated_at DESC LIMIT 300").all<DbRow>();
  return json({ layers: rows.results.map(rowToMapLayer) });
});

app.post("/api/admin/map-layers", async (c) => {
  await ensureBootstrapUser(c.env);
  const actor = await requireActor(c.req.raw, c.env, rolesForAdminOnly());
  if (actor instanceof Response) return actor;
  const body = (await c.req.json()) as Partial<{ type: string; label: string; description: string; geometry: Record<string, unknown>; status: string; visibility: string; verificationLevel: VerificationLevel; organizationId: string; sourceUrl: string }>;
  if (!body.type || !body.label || !body.geometry) return badRequest("Layer type, label, and geometry are required.");
  const id = makeId("layer");
  const timestamp = nowIso();
  await c.env.DB.prepare(
    `INSERT INTO map_layers (
      id, type, label, description, geometry_json, status, visibility, verification_level, organization_id, source_url, updated_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, body.type, body.label, body.description ?? null, JSON.stringify(body.geometry), body.status ?? "active", body.visibility ?? "public", body.verificationLevel ?? "contact_verified", body.organizationId ?? null, body.sourceUrl ?? null, timestamp, timestamp).run();
  await audit(c.env.DB, { actorEmail: actor.email, action: "map_layer_created", entityType: "map_layer", entityId: id, after: body });
  return json({ id }, { status: 201 });
});

app.patch("/api/admin/map-layers/:id", async (c) => {
  await ensureBootstrapUser(c.env);
  const actor = await requireActor(c.req.raw, c.env, rolesForAdminOnly());
  if (actor instanceof Response) return actor;
  const body = (await c.req.json()) as Partial<{ type: string; label: string; description: string; geometry: Record<string, unknown>; status: string; visibility: string; verificationLevel: VerificationLevel; organizationId: string; sourceUrl: string }>;
  const timestamp = nowIso();
  const result = await c.env.DB.prepare(
    `UPDATE map_layers
     SET type = COALESCE(?, type), label = COALESCE(?, label), description = COALESCE(?, description),
         geometry_json = COALESCE(?, geometry_json), status = COALESCE(?, status), visibility = COALESCE(?, visibility),
         verification_level = COALESCE(?, verification_level), organization_id = COALESCE(?, organization_id),
         source_url = COALESCE(?, source_url), updated_at = ?
     WHERE id = ?`
  ).bind(body.type ?? null, body.label ?? null, body.description ?? null, body.geometry ? JSON.stringify(body.geometry) : null, body.status ?? null, body.visibility ?? null, body.verificationLevel ?? null, body.organizationId ?? null, body.sourceUrl ?? null, timestamp, c.req.param("id")).run();
  if (!result.meta.changes) return badRequest("Map layer not found.", 404);
  await audit(c.env.DB, { actorEmail: actor.email, action: "map_layer_updated", entityType: "map_layer", entityId: c.req.param("id"), after: body });
  return json({ ok: true });
});

app.get("/api/admin/resource-translations", async (c) => {
  await ensureBootstrapUser(c.env);
  const actor = await requireActor(c.req.raw, c.env);
  if (actor instanceof Response) return actor;
  const rows = await c.env.DB.prepare("SELECT * FROM resource_translations ORDER BY updated_at DESC LIMIT 300").all<DbRow>();
  return json({ translations: rows.results.map(rowToResourceTranslation) });
});

app.post("/api/admin/resource-translations", async (c) => {
  await ensureBootstrapUser(c.env);
  const actor = await requireActor(c.req.raw, c.env);
  if (actor instanceof Response) return actor;
  const body = (await c.req.json()) as Partial<{ resourceId: string; locale: string; name: string; description: string; services: string; currentNeeds: string }>;
  if (!body.resourceId || !body.locale) return badRequest("Resource and locale are required.");
  const id = makeId("rtr");
  const timestamp = nowIso();
  await c.env.DB.prepare(
    `INSERT INTO resource_translations (id, resource_id, locale, name, description, services, current_needs, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(resource_id, locale) DO UPDATE SET name = excluded.name, description = excluded.description,
       services = excluded.services, current_needs = excluded.current_needs, updated_at = excluded.updated_at`
  ).bind(id, body.resourceId, body.locale, body.name ?? null, body.description ?? null, body.services ?? null, body.currentNeeds ?? null, timestamp).run();
  await audit(c.env.DB, { actorEmail: actor.email, action: "resource_translation_saved", entityType: "resource_translation", entityId: `${body.resourceId}:${body.locale}`, after: body });
  return json({ id }, { status: 201 });
});

app.get("/api/admin/locale-overrides", async (c) => {
  await ensureBootstrapUser(c.env);
  const actor = await requireActor(c.req.raw, c.env, rolesForAdminOnly());
  if (actor instanceof Response) return actor;
  const rows = await c.env.DB.prepare("SELECT * FROM locale_overrides ORDER BY locale ASC, namespace ASC, key ASC LIMIT 500").all<DbRow>();
  return json({ overrides: rows.results.map(rowToLocaleOverride) });
});

app.post("/api/admin/locale-overrides", async (c) => {
  await ensureBootstrapUser(c.env);
  const actor = await requireActor(c.req.raw, c.env, rolesForAdminOnly());
  if (actor instanceof Response) return actor;
  const body = (await c.req.json()) as Partial<{ locale: string; namespace: string; key: string; value: string }>;
  if (!body.locale || !body.namespace || !body.key || !body.value) return badRequest("Locale, namespace, key, and value are required.");
  const id = makeId("loc");
  const timestamp = nowIso();
  await c.env.DB.prepare(
    `INSERT INTO locale_overrides (id, locale, namespace, key, value, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(locale, namespace, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).bind(id, body.locale, body.namespace, body.key, body.value, timestamp).run();
  await c.env.CONFIG_KV.delete("public-config").catch(() => undefined);
  await audit(c.env.DB, { actorEmail: actor.email, action: "locale_override_saved", entityType: "locale_override", entityId: `${body.locale}:${body.namespace}:${body.key}`, after: body });
  return json({ id }, { status: 201 });
});

app.get("/api/admin/ai/suggestions", async (c) => {
  await ensureBootstrapUser(c.env);
  const actor = await requireActor(c.req.raw, c.env);
  if (actor instanceof Response) return actor;
  const rows = await c.env.DB.prepare("SELECT * FROM ai_suggestions ORDER BY created_at DESC LIMIT 200").all<DbRow>();
  return json({ suggestions: rows.results.map(rowToAiSuggestion) });
});

app.post("/api/admin/ai/moderation-suggestion", async (c) => {
  await ensureBootstrapUser(c.env);
  const actor = await requireActor(c.req.raw, c.env);
  if (actor instanceof Response) return actor;
  const body = (await c.req.json()) as Partial<{ entityType: string; entityId: string; text: string }>;
  const text = body.text ?? await moderationSuggestionText(c.env.DB, body.entityType, body.entityId);
  if (!text) return badRequest("Text or entity reference is required.");
  const suggestion = moderationSuggestion(text, featureEnabled(c.env.ENABLE_WORKERS_AI));
  const id = await storeAiSuggestion(c.env.DB, actor, "moderation_suggestion", body.entityType ?? null, body.entityId ?? null, { text }, suggestion);
  return json({ id, suggestion }, { status: 201 });
});

app.post("/api/admin/ai/translation-draft", async (c) => {
  await ensureBootstrapUser(c.env);
  const actor = await requireActor(c.req.raw, c.env);
  if (actor instanceof Response) return actor;
  const body = (await c.req.json()) as Partial<{ text: string; locale: string; entityType: string; entityId: string }>;
  if (!body.text) return badRequest("Text is required.");
  const suggestion = translationDraft(body.text, body.locale ?? "es", featureEnabled(c.env.ENABLE_WORKERS_AI));
  const id = await storeAiSuggestion(c.env.DB, actor, "translation_draft", body.entityType ?? null, body.entityId ?? null, body, suggestion);
  return json({ id, suggestion }, { status: 201 });
});

app.get("/api/admin/health", async (c) => {
  await ensureBootstrapUser(c.env);
  const actor = await requireActor(c.req.raw, c.env, rolesForAdminOnly());
  if (actor instanceof Response) return actor;
  const metrics = await healthMetrics(c.env.DB);
  return json({ metrics });
});

app.get("/api/admin/audit-logs", async (c) => {
  await ensureBootstrapUser(c.env);
  const actor = await requireActor(c.req.raw, c.env, rolesForAdminOnly());
  if (actor instanceof Response) return actor;
  const logs = await c.env.DB.prepare("SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 200").all<DbRow>();
  return json({ logs: logs.results });
});

app.onError((error, c) => {
  console.error(JSON.stringify({ message: "unhandled_error", error: error.message, path: new URL(c.req.url).pathname }));
  return json({ error: "Internal server error" }, { status: 500 });
});

app.notFound(() => json({ error: "Not found" }, { status: 404 }));

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return await app.fetch(request, env, ctx);
  },
  async email(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext): Promise<void> {
    const raw = await new Response(message.raw).text();
    const subject = message.headers.get("subject") ?? null;
    const text = extractPlainEmailText(raw);
    ctx.waitUntil(storeInboundEmail(env, {
      from: message.from,
      to: message.to,
      subject,
      text,
      reportSlug: reportSlugFromSubject(subject)
    }));
    if (env.EMAIL_FORWARD_TO) {
      ctx.waitUntil(message.forward(env.EMAIL_FORWARD_TO, new Headers({ "X-emergOS-Inbound": "true" })).catch((error) => {
        console.error(JSON.stringify({ message: "email_forward_failed", error: error instanceof Error ? error.message : String(error) }));
      }));
    }
  },
  async queue(batch: MessageBatch, env: Env): Promise<void> {
    for (const message of batch.messages) {
      console.log(JSON.stringify({ message: "queue_job", body: message.body }));
      const body = message.body as Record<string, unknown>;
      try {
        if (body.type === "duplicate_check" && typeof body.reportId === "string") {
          await runDuplicateCheck(env.DB, body.reportId);
        } else if (body.type === "import_csv" && typeof body.importJobId === "string") {
          await runCsvImport(env, body.importJobId);
        } else if (body.type === "export_csv" && typeof body.exportJobId === "string") {
          await runCsvExport(env, body.exportJobId);
        } else if (body.type === "send_notification" && typeof body.notificationId === "string") {
          await sendNotification(env, body.notificationId);
        } else if (body.type === "run_workflow" && typeof body.workflowRunId === "string") {
          await runWorkflow(env, body.workflowRunId);
        } else if (body.type === "import_geodata" && typeof body.geodataImportId === "string") {
          await runGeodataImport(env, body.geodataImportId);
        } else if (body.type === "index_entity" && typeof body.entityType === "string" && typeof body.entityId === "string") {
          await indexEntity(env.DB, body.entityType, body.entityId);
        }
      } catch (error) {
        console.error(JSON.stringify({ message: "queue_job_failed", body: message.body, error: error instanceof Error ? error.message : String(error) }));
        throw error;
      }
      message.ack();
    }
    await env.CONFIG_KV.put("last-queue-drain", nowIso(), { expirationTtl: 3600 }).catch(() => undefined);
  }
} satisfies ExportedHandler<Env>;

async function runDuplicateCheck(db: D1Database, reportId: string): Promise<void> {
  const target = await reportSearchRow(db, reportId);
  if (!target) return;
  const candidates = await db.prepare(
    `SELECT r.id, r.last_seen_city, r.last_seen_admin1, r.reporter_contact_private,
            COALESCE(p.normalized_name, lower(pet.name)) AS normalized_name,
            p.age AS age
     FROM reports r
     LEFT JOIN people p ON p.id = r.person_id
     LEFT JOIN pets pet ON pet.id = r.pet_id
     WHERE r.id != ? AND r.status != 'duplicate'
     ORDER BY r.updated_at DESC
     LIMIT 200`
  ).bind(reportId).all<DbRow>();

  for (const candidate of candidates.results) {
    const { score, reasons } = duplicateScore(target, candidate);
    if (score < 45) continue;
    const first = String(target.id) < String(candidate.id) ? String(target.id) : String(candidate.id);
    const second = String(target.id) < String(candidate.id) ? String(candidate.id) : String(target.id);
    const timestamp = nowIso();
    await db.prepare(
      `INSERT INTO duplicate_candidates (id, report_id, candidate_report_id, score, reasons_json, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(report_id, candidate_report_id) DO UPDATE SET score = excluded.score, reasons_json = excluded.reasons_json, status = 'open', updated_at = excluded.updated_at`
    ).bind(makeId("dup"), first, second, score, JSON.stringify(reasons), "open", timestamp, timestamp).run();
  }
}

async function runCsvImport(env: Env, importJobId: string): Promise<void> {
  const job = await env.DB.prepare("SELECT * FROM import_jobs WHERE id = ?").bind(importJobId).first<DbRow>();
  if (!job || typeof job.bucket_key !== "string") return;
  const timestamp = nowIso();
  await env.DB.prepare("UPDATE import_jobs SET status = 'running', updated_at = ? WHERE id = ?").bind(timestamp, importJobId).run();
  const object = await env.MEDIA.get(job.bucket_key);
  if (!object) throw new Error("Import file missing from R2.");
  const csv = await object.text();
  const rows = parseCsv(csv);
  const errors: string[] = [];
  let processed = 0;

  for (const [index, row] of rows.entries()) {
    try {
      if (job.type === "resources") {
        await insertResourceFromCsv(env.DB, row);
      } else if (job.type === "contacts") {
        await insertContactFromCsv(env.DB, row);
      } else if (job.type === "admin_areas") {
        await insertAdminAreaFromCsv(env.DB, row);
      } else {
        throw new Error(`Unsupported import type: ${String(job.type)}`);
      }
      processed += 1;
    } catch (error) {
      errors.push(`Row ${index + 2}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  await env.DB.prepare(
    "UPDATE import_jobs SET status = ?, total_rows = ?, processed_rows = ?, error_rows = ?, error_json = ?, updated_at = ? WHERE id = ?"
  ).bind(errors.length ? "completed_with_errors" : "complete", rows.length, processed, errors.length, JSON.stringify(errors.slice(0, 50)), nowIso(), importJobId).run();
}

async function runCsvExport(env: Env, exportJobId: string): Promise<void> {
  const job = await env.DB.prepare("SELECT * FROM export_jobs WHERE id = ?").bind(exportJobId).first<DbRow>();
  if (!job) return;
  await env.DB.prepare("UPDATE export_jobs SET status = 'running', updated_at = ? WHERE id = ?").bind(nowIso(), exportJobId).run();
  const { csv, count } = await buildCsvExport(env.DB, String(job.type));
  const key = `exports/${exportJobId}-${String(job.type)}.csv`;
  await env.MEDIA.put(key, csv, { httpMetadata: { contentType: "text/csv; charset=utf-8" } });
  await env.DB.prepare("UPDATE export_jobs SET status = 'complete', bucket_key = ?, row_count = ?, updated_at = ? WHERE id = ?")
    .bind(key, count, nowIso(), exportJobId)
    .run();
}

async function sendNotification(env: Env, notificationId: string): Promise<void> {
  const event = await env.DB.prepare("SELECT * FROM notification_events WHERE id = ?").bind(notificationId).first<DbRow>();
  if (!event) return;
  const timestamp = nowIso();
  const channel = String(event.channel);
  const providerConfigured = channel === "email"
    ? Boolean(env.OPTIONAL_EMAIL_PROVIDER_API_KEY || env.EMAIL_FROM)
    : channel === "sms"
      ? Boolean(env.OPTIONAL_SMS_PROVIDER_API_KEY)
      : channel === "whatsapp"
        ? Boolean(env.OPTIONAL_WHATSAPP_PROVIDER_API_KEY)
        : false;
  const status = providerConfigured ? "queued_provider" : "provider_not_configured";
  const lastError = providerConfigured ? null : `${channel} adapter is not configured for this deployment`;
  await env.DB.prepare(
    "UPDATE notification_events SET status = ?, attempts = attempts + 1, last_error = ?, updated_at = ? WHERE id = ?"
  ).bind(status, lastError, timestamp, notificationId).run();
}

async function runWorkflow(env: Env, workflowRunId: string): Promise<void> {
  const run = await env.DB.prepare("SELECT * FROM workflow_runs WHERE id = ?").bind(workflowRunId).first<DbRow>();
  if (!run) return;
  const timestamp = nowIso();
  await env.DB.prepare("UPDATE workflow_runs SET status = 'running', step = ?, updated_at = ? WHERE id = ?")
    .bind(workflowStepForType(String(run.type)), timestamp, workflowRunId)
    .run();
  await env.DB.prepare("UPDATE workflow_runs SET status = 'complete', step = 'complete', updated_at = ? WHERE id = ?")
    .bind(nowIso(), workflowRunId)
    .run();
}

async function runGeodataImport(env: Env, geodataImportId: string): Promise<void> {
  const job = await env.DB.prepare("SELECT * FROM geodata_imports WHERE id = ?").bind(geodataImportId).first<DbRow>();
  if (!job || typeof job.bucket_key !== "string") return;
  await env.DB.prepare("UPDATE geodata_imports SET status = 'running', updated_at = ? WHERE id = ?").bind(nowIso(), geodataImportId).run();
  const object = await env.MEDIA.get(job.bucket_key);
  if (!object) throw new Error("Geodata import file missing from R2.");
  const parsed = JSON.parse(await object.text()) as { type?: string; features?: Array<Record<string, unknown>> };
  const features = Array.isArray(parsed.features) ? parsed.features : [];
  const errors: string[] = [];
  let processed = 0;
  for (const [index, feature] of features.entries()) {
    try {
      if (job.type === "admin_areas_geojson") {
        await insertAdminAreaFromFeature(env.DB, feature);
      } else if (job.type === "resources_geojson") {
        await insertResourceFromFeature(env.DB, feature);
      } else if (job.type === "map_layers_geojson") {
        await insertMapLayerFromFeature(env.DB, feature);
      } else {
        throw new Error(`Unsupported geodata import type: ${String(job.type)}`);
      }
      processed += 1;
    } catch (error) {
      errors.push(`Feature ${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  await env.DB.prepare(
    "UPDATE geodata_imports SET status = ?, total_features = ?, processed_features = ?, error_features = ?, error_json = ?, updated_at = ? WHERE id = ?"
  ).bind(errors.length ? "completed_with_errors" : "complete", features.length, processed, errors.length, JSON.stringify(errors.slice(0, 50)), nowIso(), geodataImportId).run();
}

async function indexEntity(db: D1Database, entityType: string, entityId: string): Promise<void> {
  const timestamp = nowIso();
  let text: string | null = null;
  if (entityType === "report") {
    const report = await findReportById(db, entityId);
    if (report) text = [report.displayName, report.description, report.lastSeenText, report.lastSeenCity, report.lastSeenAdmin1, report.notesPublic].filter(Boolean).join(" ");
  } else if (entityType === "resource") {
    const resource = await db.prepare("SELECT * FROM resources WHERE id = ?").bind(entityId).first<DbRow>();
    if (resource) text = [resource.name, resource.description, resource.address, resource.city, resource.admin1, resource.type].filter(Boolean).join(" ");
  }
  if (!text) return;
  await db.prepare(
    `INSERT INTO semantic_index_records (id, entity_type, entity_id, text, keywords, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(entity_type, entity_id) DO UPDATE SET text = excluded.text, keywords = excluded.keywords, status = 'indexed', updated_at = excluded.updated_at`
  ).bind(makeId("index"), entityType, entityId, text, normalizeText(text), "indexed", timestamp, timestamp).run();
}

async function semanticSearch(db: D1Database, query: string): Promise<{ reports: PublicReport[]; resources: ReturnType<typeof rowToResource>[] }> {
  const keywords = normalizeText(query);
  const rows = await db.prepare(
    `SELECT entity_type, entity_id
     FROM semantic_index_records
     WHERE status = 'indexed' AND (keywords LIKE ? OR text LIKE ?)
     ORDER BY updated_at DESC
     LIMIT 50`
  ).bind(`%${keywords}%`, `%${query}%`).all<{ entity_type: string; entity_id: string }>();
  const reports: PublicReport[] = [];
  const resources: ReturnType<typeof rowToResource>[] = [];
  for (const row of rows.results) {
    if (row.entity_type === "report") {
      const report = await findReportById(db, row.entity_id);
      if (report?.moderationStatus === "published") reports.push(report);
    } else if (row.entity_type === "resource") {
      const resource = await db.prepare("SELECT * FROM resources WHERE id = ?").bind(row.entity_id).first<DbRow>();
      if (resource) resources.push(rowToResource(resource));
    }
  }
  return { reports, resources };
}

async function reportSearchRow(db: D1Database, reportId: string): Promise<DbRow | null> {
  return await db.prepare(
    `SELECT r.id, r.last_seen_city, r.last_seen_admin1, r.reporter_contact_private,
            COALESCE(p.normalized_name, lower(pet.name)) AS normalized_name,
            p.age AS age
     FROM reports r
     LEFT JOIN people p ON p.id = r.person_id
     LEFT JOIN pets pet ON pet.id = r.pet_id
     WHERE r.id = ?`
  ).bind(reportId).first<DbRow>();
}

function duplicateScore(a: DbRow, b: DbRow): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  const nameA = String(a.normalized_name ?? "");
  const nameB = String(b.normalized_name ?? "");
  if (nameA && nameB && nameA === nameB) {
    score += 50;
    reasons.push("same_normalized_name");
  } else if (nameA && nameB && (nameA.includes(nameB) || nameB.includes(nameA))) {
    score += 30;
    reasons.push("similar_name");
  }
  if (a.age !== null && a.age !== undefined && b.age !== null && b.age !== undefined && Number(a.age) === Number(b.age)) {
    score += 15;
    reasons.push("same_age");
  }
  if (a.last_seen_city && b.last_seen_city && normalizeText(String(a.last_seen_city)) === normalizeText(String(b.last_seen_city))) {
    score += 20;
    reasons.push("same_city");
  }
  if (a.last_seen_admin1 && b.last_seen_admin1 && normalizeText(String(a.last_seen_admin1)) === normalizeText(String(b.last_seen_admin1))) {
    score += 10;
    reasons.push("same_region");
  }
  if (a.reporter_contact_private && b.reporter_contact_private && a.reporter_contact_private === b.reporter_contact_private) {
    score += 25;
    reasons.push("same_reporter_contact");
  }
  return { score, reasons };
}

function parseCsv(csv: string): Array<Record<string, string>> {
  const lines = csv.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (!lines.length) return [];
  const headers = splitCsvLine(lines[0]).map((header) => header.trim());
  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = values[index]?.trim() ?? "";
    });
    return row;
  });
}

function splitCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current);
  return values;
}

function csvEscape(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

async function insertResourceFromCsv(db: D1Database, row: Record<string, string>): Promise<void> {
  if (!row.name || !row.type) throw new Error("name and type are required");
  const timestamp = nowIso();
  await db.prepare(
    `INSERT INTO resources (
      id, type, name, description, address, admin1, city, lat, lng, hours, capacity,
      availability_status, contact_public, source_url, verification_level, last_verified_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    makeId("res"),
    row.type,
    row.name,
    row.description || null,
    row.address || null,
    row.admin1 || null,
    row.city || null,
    row.lat ? Number(row.lat) : null,
    row.lng ? Number(row.lng) : null,
    row.hours || null,
    row.capacity || null,
    row.availability_status || "unknown",
    row.contact_public || null,
    row.source_url || null,
    row.verification_level || "contact_verified",
    timestamp,
    timestamp,
    timestamp
  ).run();
}

async function insertContactFromCsv(db: D1Database, row: Record<string, string>): Promise<void> {
  if (!row.label || !row.contact) throw new Error("label and contact are required");
  const timestamp = nowIso();
  await db.prepare(
    "INSERT INTO emergency_contacts (id, label, contact, description, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).bind(makeId("contact"), row.label, row.contact, row.description || null, row.sort_order ? Number(row.sort_order) : 0, timestamp, timestamp).run();
}

async function insertAdminAreaFromCsv(db: D1Database, row: Record<string, string>): Promise<void> {
  if (!row.country_code || !row.level || !row.name) throw new Error("country_code, level, and name are required");
  await db.prepare(
    "INSERT INTO admin_areas (id, country_code, level, name, ascii_name, parent_id, lat, lng, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(makeId("area"), row.country_code, row.level, row.name, row.ascii_name || null, row.parent_id || null, row.lat ? Number(row.lat) : null, row.lng ? Number(row.lng) : null, row.source || "csv").run();
}

async function insertAdminAreaFromFeature(db: D1Database, feature: Record<string, unknown>): Promise<void> {
  const props = featureProperties(feature);
  const point = featurePoint(feature);
  const name = stringProp(props, "name");
  const level = stringProp(props, "level") ?? "locality";
  const country = stringProp(props, "country_code") ?? stringProp(props, "country") ?? "XX";
  if (!name) throw new Error("feature.properties.name is required");
  await db.prepare(
    "INSERT INTO admin_areas (id, country_code, level, name, ascii_name, parent_id, lat, lng, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(makeId("area"), country, level, name, stringProp(props, "ascii_name"), stringProp(props, "parent_id"), point?.lat ?? null, point?.lng ?? null, "geojson").run();
}

async function insertResourceFromFeature(db: D1Database, feature: Record<string, unknown>): Promise<void> {
  const props = featureProperties(feature);
  const point = featurePoint(feature);
  const name = stringProp(props, "name");
  if (!name) throw new Error("feature.properties.name is required");
  const timestamp = nowIso();
  await db.prepare(
    `INSERT INTO resources (
      id, type, name, description, address, admin1, city, lat, lng, location_precision, hours, capacity,
      availability_status, contact_public, source_url, verification_level, last_verified_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    makeId("res"),
    stringProp(props, "type") ?? "official_resource",
    name,
    stringProp(props, "description"),
    stringProp(props, "address"),
    stringProp(props, "admin1"),
    stringProp(props, "city"),
    point?.lat ?? null,
    point?.lng ?? null,
    stringProp(props, "location_precision") ?? "area",
    stringProp(props, "hours"),
    stringProp(props, "capacity"),
    stringProp(props, "availability_status") ?? "unknown",
    stringProp(props, "contact_public"),
    stringProp(props, "source_url"),
    stringProp(props, "verification_level") ?? "contact_verified",
    timestamp,
    timestamp,
    timestamp
  ).run();
}

async function insertMapLayerFromFeature(db: D1Database, feature: Record<string, unknown>): Promise<void> {
  const props = featureProperties(feature);
  const geometry = typeof feature.geometry === "object" && feature.geometry !== null ? feature.geometry as Record<string, unknown> : null;
  if (!geometry) throw new Error("feature.geometry is required");
  const label = stringProp(props, "label") ?? stringProp(props, "name");
  if (!label) throw new Error("feature.properties.label or name is required");
  const timestamp = nowIso();
  await db.prepare(
    `INSERT INTO map_layers (
      id, type, label, description, geometry_json, status, visibility, verification_level, organization_id, source_url, updated_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    makeId("layer"),
    stringProp(props, "type") ?? "service_area",
    label,
    stringProp(props, "description"),
    JSON.stringify(geometry),
    stringProp(props, "status") ?? "active",
    stringProp(props, "visibility") ?? "public",
    stringProp(props, "verification_level") ?? "contact_verified",
    stringProp(props, "organization_id"),
    stringProp(props, "source_url"),
    timestamp,
    timestamp
  ).run();
}

async function buildCsvExport(db: D1Database, type: string): Promise<{ csv: string; count: number }> {
  if (type === "resources") {
    const rows = await db.prepare("SELECT type, name, description, address, admin1, city, lat, lng, hours, capacity, availability_status, contact_public, source_url, verification_level FROM resources ORDER BY updated_at DESC").all<DbRow>();
    return rowsToCsv(rows.results);
  }
  if (type === "reports") {
    const rows = await db.prepare(
      `SELECT r.id, r.type, r.status, r.verification_level, r.public_slug, r.last_seen_text, r.last_seen_city, r.last_seen_admin1,
              COALESCE(p.display_name, pet.name) AS display_name, p.age, COALESCE(p.age_range, pet.species) AS age_range
       FROM reports r
       LEFT JOIN people p ON p.id = r.person_id
       LEFT JOIN pets pet ON pet.id = r.pet_id
       ORDER BY r.updated_at DESC`
    ).all<DbRow>();
    return rowsToCsv(rows.results);
  }
  if (type === "contacts") {
    const rows = await db.prepare("SELECT label, contact, description, sort_order FROM emergency_contacts ORDER BY sort_order ASC").all<DbRow>();
    return rowsToCsv(rows.results);
  }
  if (type === "volunteers") {
    const rows = await db.prepare("SELECT id, name, location, skills, languages, availability, status, assigned_organization_id, created_at FROM volunteers ORDER BY created_at DESC").all<DbRow>();
    return rowsToCsv(rows.results);
  }
  throw new Error(`Unsupported export type: ${type}`);
}

function rowsToCsv(rows: DbRow[]): { csv: string; count: number } {
  if (!rows.length) return { csv: "", count: 0 };
  const headers = Object.keys(rows[0]);
  const csv = [
    headers.map(csvEscape).join(","),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(","))
  ].join("\n");
  return { csv, count: rows.length };
}

async function generatedFileResponse(env: Env, fileId: string): Promise<Response> {
  const file = await env.DB.prepare("SELECT bucket_key, mime_type, type, label FROM generated_files WHERE id = ? AND status = 'complete'")
    .bind(fileId)
    .first<{ bucket_key: string; mime_type: string; type: string; label: string | null }>();
  if (!file) return new Response("Not found", { status: 404 });
  const object = await env.MEDIA.get(file.bucket_key);
  if (!object) return new Response("Not found", { status: 404 });
  const extension = file.mime_type.includes("pdf") ? "pdf" : file.mime_type.includes("csv") ? "csv" : "json";
  const filename = `${slugify(file.label || file.type, fileId)}.${extension}`;
  return new Response(object.body, {
    headers: {
      "Content-Type": file.mime_type,
      "Content-Disposition": `attachment; filename="${filename}"`
    }
  });
}

async function createGeneratedFile(
  env: Env,
  actor: Actor,
  input: { type: string; entityType: string | null; entityId: string | null; label: string | null }
): Promise<{ fileId: string } | { error: Response }> {
  const fileId = makeId("file");
  const timestamp = nowIso();
  let body: string | Uint8Array;
  let mimeType: string;
  let extension: string;
  let label = input.label;

  if (input.type === "flyer_pdf" || input.type === "flyer_a5_pdf" || input.type === "flyer_mini4_pdf" || input.type === "flyer_poster_pdf" || input.type === "pet_flyer_pdf") {
    if (input.entityType !== "report" || !input.entityId) return { error: badRequest("A report ID is required for flyer PDFs.") };
    const report = await findReportById(env.DB, input.entityId);
    if (!report) return { error: badRequest("Report not found.", 404) };
    if (actor.role === "organization_manager" && (!report.assignedOrganizationId || !(await actorCanManageOrganization(env.DB, actor, report.assignedOrganizationId)))) {
      return { error: badRequest("Insufficient organization permissions.", 403) };
    }
    const format = input.type === "flyer_a5_pdf" ? "A5" : input.type === "flyer_mini4_pdf" ? "four-per-page" : input.type === "flyer_poster_pdf" ? "QR poster" : input.type === "pet_flyer_pdf" ? "pet flyer" : "A4 flyer";
    label = label ?? `${report.displayName} ${format}`;
    body = createSimplePdf(label, [
      `${report.subjectType === "pet" ? "Pet" : "Name"}: ${report.displayName}`,
      `Status: ${report.status}`,
      `${report.type === "found_person" || report.type === "found_pet" ? "Found" : "Last seen"}: ${report.lastSeenText ?? "Unknown"}`,
      `Area: ${[report.lastSeenCity, report.lastSeenAdmin1].filter(Boolean).join(", ") || "Unknown"}`,
      `Verification: ${report.verificationLevel}`,
      `Contact: ${report.publicContactValue ?? "Use protected contact form"}`,
      `QR page: /reports/${report.publicSlug}`
    ]);
    mimeType = "application/pdf";
    extension = "pdf";
  } else if (input.type === "resource_sheet_pdf") {
    if (input.entityType !== "resource" || !input.entityId) return { error: badRequest("A resource ID is required for resource sheets.") };
    const resource = await env.DB.prepare("SELECT * FROM resources WHERE id = ?").bind(input.entityId).first<DbRow>();
    if (!resource) return { error: badRequest("Resource not found.", 404) };
    const resourceOrgId = typeof resource.organization_id === "string" ? resource.organization_id : null;
    if (actor.role === "organization_manager" && (!resourceOrgId || !(await actorCanManageOrganization(env.DB, actor, resourceOrgId)))) {
      return { error: badRequest("Insufficient organization permissions.", 403) };
    }
    label = label ?? `${String(resource.name)} resource sheet`;
    body = createSimplePdf(label, [
      `Type: ${String(resource.type)}`,
      `Address: ${[resource.address, resource.city, resource.admin1].filter(Boolean).join(", ") || "Unknown"}`,
      `Hours: ${String(resource.hours ?? "Unknown")}`,
      `Capacity: ${String(resource.capacity ?? "Unknown")}`,
      `Availability: ${String(resource.availability_status ?? "unknown")}`,
      `Contact: ${String(resource.contact_public ?? "Not listed")}`,
      `Verification: ${String(resource.verification_level ?? "unverified")}`
    ]);
    mimeType = "application/pdf";
    extension = "pdf";
  } else if (input.type === "resource_sheet_csv") {
    const orgIds = actor.role === "organization_manager" ? await actorOrganizationIds(env.DB, actor) : null;
    if (orgIds && !orgIds.length) return { error: badRequest("No organization membership found.", 403) };
    const where = orgIds ? `WHERE organization_id IN (${orgIds.map(() => "?").join(", ")})` : "";
    const rows = await env.DB.prepare(
      `SELECT type, name, description, address, admin1, city, hours, capacity, availability_status, contact_public, source_url, verification_level
       FROM resources
       ${where}
       ORDER BY updated_at DESC
       LIMIT 500`
    ).bind(...(orgIds ?? [])).all<DbRow>();
    body = rowsToCsv(rows.results).csv;
    label = label ?? "Resource sheet CSV";
    mimeType = "text/csv; charset=utf-8";
    extension = "csv";
  } else {
    return { error: badRequest("Unsupported generated file type.") };
  }

  const key = `generated/${fileId}.${extension}`;
  await env.MEDIA.put(key, body, { httpMetadata: { contentType: mimeType } });
  await env.DB.prepare(
    `INSERT INTO generated_files (id, type, entity_type, entity_id, bucket_key, mime_type, size_bytes, created_by_user_id, created_at, status, label)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(fileId, input.type, input.entityType, input.entityId, key, mimeType, typeof body === "string" ? byteLength(body) : body.byteLength, actor.userId, timestamp, "complete", label).run();
  return { fileId };
}

async function buildDataRequestExport(db: D1Database, request: DbRow): Promise<Record<string, unknown>> {
  const reportId = typeof request.report_id === "string" ? request.report_id : null;
  const [report, tips, statusEvents, contactMessages] = reportId
    ? await Promise.all([
        findReportById(db, reportId),
        db.prepare("SELECT id, body, location_text, occurred_at, moderation_status, created_at FROM tips WHERE report_id = ? ORDER BY created_at DESC").bind(reportId).all<DbRow>(),
        db.prepare("SELECT old_status, new_status, verification_level, source_type, source_note, created_at FROM status_events WHERE report_id = ? ORDER BY created_at ASC").bind(reportId).all<DbRow>(),
        db.prepare("SELECT id, sender_name, body, moderation_status, created_at FROM contact_messages WHERE report_id = ? ORDER BY created_at DESC").bind(reportId).all<DbRow>()
      ])
    : [null, { results: [] as DbRow[] }, { results: [] as DbRow[] }, { results: [] as DbRow[] }];
  return {
    request: rowToDataRequest(request),
    report,
    tips: tips.results,
    statusEvents: statusEvents.results,
    contactMessages: contactMessages.results,
    generatedAt: nowIso()
  };
}

async function retentionPreview(db: D1Database, policy?: RetentionPolicy): Promise<Record<string, number>> {
  const activePolicy = policy ?? await readRetentionPolicy(db);
  const [tips, auditLogs, volunteers] = await Promise.all([
    count(db, "SELECT COUNT(*) AS count FROM tips WHERE created_at < datetime('now', ?)", `-${activePolicy.tipsDaysAfterClosure} days`),
    count(db, "SELECT COUNT(*) AS count FROM audit_logs WHERE created_at < datetime('now', ?)", `-${activePolicy.auditLogDays} days`),
    count(db, "SELECT COUNT(*) AS count FROM volunteers WHERE created_at < datetime('now', ?) AND status != 'consent_expired'", `-${activePolicy.volunteerDaysAfterCrisis} days`)
  ]);
  return { oldTips: tips, oldAuditLogs: auditLogs, volunteersNeedingConsentRenewal: volunteers };
}

async function readRetentionPolicy(db: D1Database): Promise<RetentionPolicy> {
  const row = await db.prepare("SELECT * FROM retention_policies WHERE id = 'default-retention-policy'").first<DbRow>();
  const timestamp = nowIso();
  if (!row) {
    return {
      id: "default-retention-policy",
      name: "Default crisis retention",
      tipsDaysAfterClosure: 90,
      auditLogDays: 365,
      volunteerDaysAfterCrisis: 30,
      enabled: false,
      updatedAt: timestamp
    };
  }
  return {
    id: String(row.id),
    name: String(row.name),
    tipsDaysAfterClosure: Number(row.tips_days_after_closure ?? 90),
    auditLogDays: Number(row.audit_log_days ?? 365),
    volunteerDaysAfterCrisis: Number(row.volunteer_days_after_crisis ?? 30),
    enabled: Boolean(row.enabled),
    updatedAt: String(row.updated_at ?? timestamp)
  };
}

function saneRetentionDays(value: unknown, fallback: number): number {
  const days = Number(value);
  return Number.isInteger(days) && days >= 1 && days <= 3650 ? days : fallback;
}

async function assertOrganizationExists(db: D1Database, organizationId: string): Promise<boolean> {
  const row = await db.prepare("SELECT id FROM organizations WHERE id = ?").bind(organizationId).first<{ id: string }>();
  return Boolean(row);
}

async function approveOrganizationApplication(db: D1Database, applicationId: string, actor: Actor): Promise<string | null> {
  const application = await db.prepare("SELECT * FROM organization_applications WHERE id = ?").bind(applicationId).first<DbRow>();
  if (!application) return null;
  if (application.created_organization_id) {
    await db.prepare("UPDATE organization_applications SET status = 'approved', updated_at = ? WHERE id = ?").bind(nowIso(), applicationId).run();
    return String(application.created_organization_id);
  }
  const organizationId = makeId("org");
  const timestamp = nowIso();
  await db.prepare(
    `INSERT INTO organizations (
      id, name, type, description, website, contact_public, contact_private,
      verification_status, verification_evidence, onboarding_status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      organizationId,
      application.name,
      application.type,
      application.description ?? null,
      application.website ?? null,
      application.contact_public ?? null,
      application.contact_private ?? null,
      "org_verified",
      application.verification_evidence ?? null,
      "approved",
      timestamp,
      timestamp
    )
    .run();
  await db.prepare("UPDATE organization_applications SET status = 'approved', created_organization_id = ?, updated_at = ? WHERE id = ?")
    .bind(organizationId, timestamp, applicationId)
    .run();
  if (actor.userId) {
    await db.prepare(
      `INSERT OR IGNORE INTO organization_memberships (id, organization_id, user_id, role, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(makeId("orgmem"), organizationId, actor.userId, "organization_manager", timestamp, timestamp).run();
  }
  return organizationId;
}

async function actorOrganizationIds(db: D1Database, actor: Actor): Promise<string[]> {
  if (!actor.userId) return [];
  const rows = await db.prepare("SELECT organization_id FROM organization_memberships WHERE user_id = ?").bind(actor.userId).all<{ organization_id: string }>();
  return rows.results.map((row) => row.organization_id);
}

async function actorCanManageOrganization(db: D1Database, actor: Actor, organizationId: string): Promise<boolean> {
  if (actor.role === "owner" || actor.role === "admin") return await assertOrganizationExists(db, organizationId);
  if (actor.role !== "organization_manager" || !actor.userId) return false;
  const row = await db.prepare("SELECT id FROM organization_memberships WHERE user_id = ? AND organization_id = ?")
    .bind(actor.userId, organizationId)
    .first<{ id: string }>();
  return Boolean(row);
}

async function findReportById(db: D1Database, id: string): Promise<PublicReport | null> {
  const row = await db.prepare(
    `SELECT
       r.*,
       COALESCE(p.display_name, pet.name) AS display_name,
       p.age AS age,
       COALESCE(p.age_range, pet.species) AS age_range,
       COALESCE(p.description, pet.notes_public, pet.markings) AS description
     FROM reports r
     LEFT JOIN people p ON p.id = r.person_id
     LEFT JOIN pets pet ON pet.id = r.pet_id
     WHERE r.id = ?`
  ).bind(id).first<DbRow>();
  return row ? rowToReport(row) : null;
}

async function findReportForManage(db: D1Database, slug: string, token: string | undefined): Promise<PublicReport | Response> {
  if (!token) return badRequest("Manage token is required.", 403);
  const row = await db.prepare(
    `SELECT r.id
     FROM reports r
     INNER JOIN report_manage_tokens t ON t.report_id = r.id
     WHERE r.public_slug = ? AND t.token_hash = ? AND (t.expires_at IS NULL OR t.expires_at > datetime('now'))`
  ).bind(slug, await hashValue(token)).first<{ id: string }>();
  if (!row) return badRequest("Manage link is invalid or expired.", 403);
  const report = await findReportById(db, row.id);
  return report ?? badRequest("Report not found.", 404);
}

function rowToGeneratedFile(row: DbRow) {
  return {
    id: String(row.id),
    type: String(row.type),
    label: typeof row.label === "string" ? row.label : null,
    entityType: typeof row.entity_type === "string" ? row.entity_type : null,
    entityId: typeof row.entity_id === "string" ? row.entity_id : null,
    mimeType: String(row.mime_type),
    sizeBytes: row.size_bytes === null || row.size_bytes === undefined ? null : Number(row.size_bytes),
    status: String(row.status ?? "complete"),
    downloadUrl: `/api/admin/generated-files/${String(row.id)}/download`,
    createdAt: String(row.created_at)
  };
}

function rowToInboundEmail(row: DbRow) {
  return {
    id: String(row.id),
    fromEmail: typeof row.from_email === "string" ? row.from_email : null,
    toEmail: typeof row.to_email === "string" ? row.to_email : null,
    subject: typeof row.subject === "string" ? row.subject : null,
    relatedReportId: typeof row.related_report_id === "string" ? row.related_report_id : null,
    createdTipId: typeof row.created_tip_id === "string" ? row.created_tip_id : null,
    status: String(row.status),
    createdAt: String(row.created_at)
  };
}

function rowToOrganizationMembership(row: DbRow) {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    organizationName: typeof row.organization_name === "string" ? row.organization_name : null,
    userId: String(row.user_id),
    userEmail: typeof row.user_email === "string" ? row.user_email : null,
    role: String(row.role),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function rowToNotificationEvent(row: DbRow) {
  return {
    id: String(row.id),
    channel: String(row.channel),
    recipient: String(row.recipient),
    templateKey: String(row.template_key),
    status: String(row.status),
    attempts: Number(row.attempts ?? 0),
    lastError: typeof row.last_error === "string" ? row.last_error : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function rowToWorkflowRun(row: DbRow) {
  return {
    id: String(row.id),
    type: String(row.type),
    entityType: typeof row.entity_type === "string" ? row.entity_type : null,
    entityId: typeof row.entity_id === "string" ? row.entity_id : null,
    status: String(row.status),
    step: String(row.step),
    error: typeof row.error === "string" ? row.error : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function rowToGeodataImport(row: DbRow) {
  return {
    id: String(row.id),
    type: String(row.type),
    status: String(row.status),
    sourceFilename: typeof row.source_filename === "string" ? row.source_filename : null,
    totalFeatures: Number(row.total_features ?? 0),
    processedFeatures: Number(row.processed_features ?? 0),
    errorFeatures: Number(row.error_features ?? 0),
    errors: typeof row.error_json === "string" ? parseSafeStringArray(row.error_json) : [],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function rowToAiSuggestion(row: DbRow) {
  return {
    id: String(row.id),
    type: String(row.type),
    entityType: typeof row.entity_type === "string" ? row.entity_type : null,
    entityId: typeof row.entity_id === "string" ? row.entity_id : null,
    suggestion: parseSafeObject(typeof row.suggestion_json === "string" ? row.suggestion_json : "{}"),
    status: String(row.status),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

async function storeInboundEmail(
  env: Env,
  body: { from?: string | null; to?: string | null; subject?: string | null; text: string; reportSlug?: string | null }
): Promise<{ inboundEmailId: string; tipId: string | null }> {
  let report: PublicReport | null = null;
  if (body.reportSlug) report = await findPublicReport(env.DB, body.reportSlug);
  const timestamp = nowIso();
  const inboundId = makeId("email");
  let tipId: string | null = null;
  if (report) {
    tipId = makeId("tip");
    await env.DB.prepare(
      `INSERT INTO tips (
        id, report_id, body, tipper_name, tipper_contact_private, location_text, moderation_status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(tipId, report.id, body.text.trim(), body.from ?? null, JSON.stringify({ email: body.from ?? null }), null, "pending_review", timestamp).run();
    await createModerationItem(env.DB, "tip", tipId, "email_tip", []);
  }
  await env.DB.prepare(
    `INSERT INTO inbound_emails (
      id, from_email, to_email, subject, body_text, related_report_id, created_tip_id, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(inboundId, body.from ?? null, body.to ?? null, body.subject ?? null, body.text.trim(), report?.id ?? null, tipId, "pending_review", timestamp, timestamp).run();
  await audit(env.DB, { action: "inbound_email_received", entityType: "inbound_email", entityId: inboundId, after: { relatedReportId: report?.id ?? null, tipId } });
  return { inboundEmailId: inboundId, tipId };
}

async function createNotificationEvent(
  db: D1Database,
  input: { channel: string; recipient: string; templateKey: string; payload: Record<string, unknown>; userId: string | null }
): Promise<string> {
  const id = makeId("notif");
  const timestamp = nowIso();
  await db.prepare(
    `INSERT INTO notification_events (id, channel, recipient, template_key, payload_json, status, created_by_user_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, input.channel, input.recipient, input.templateKey, JSON.stringify(input.payload), "pending", input.userId, timestamp, timestamp).run();
  return id;
}

async function healthMetrics(db: D1Database) {
  const [
    pendingNotifications,
    failedNotifications,
    activeWorkflows,
    failedWorkflows,
    failedImports,
    openModeration,
    openAbuseReports,
    oldResources,
    generatedFiles
  ] = await Promise.all([
    count(db, "SELECT COUNT(*) AS count FROM notification_events WHERE status IN ('pending', 'queued_provider')"),
    count(db, "SELECT COUNT(*) AS count FROM notification_events WHERE status IN ('failed', 'provider_not_configured')"),
    count(db, "SELECT COUNT(*) AS count FROM workflow_runs WHERE status IN ('queued', 'running', 'waiting')"),
    count(db, "SELECT COUNT(*) AS count FROM workflow_runs WHERE status IN ('failed', 'errored')"),
    count(db, "SELECT COUNT(*) AS count FROM geodata_imports WHERE status = 'completed_with_errors'"),
    count(db, "SELECT COUNT(*) AS count FROM moderation_items WHERE status = 'open'"),
    count(db, "SELECT COUNT(*) AS count FROM abuse_reports WHERE status = 'open'"),
    count(db, "SELECT COUNT(*) AS count FROM resources WHERE last_verified_at IS NULL OR last_verified_at < datetime('now', '-7 days')"),
    count(db, "SELECT COUNT(*) AS count FROM generated_files WHERE status = 'complete'")
  ]);
  return {
    pendingNotifications,
    failedNotifications,
    activeWorkflows,
    failedWorkflows,
    failedImports,
    openModeration,
    openAbuseReports,
    oldResources,
    generatedFiles
  };
}

async function moderationSuggestionText(db: D1Database, entityType?: string, entityId?: string): Promise<string | null> {
  if (!entityType || !entityId) return null;
  if (entityType === "report") {
    const report = await findReportById(db, entityId);
    return report ? [report.displayName, report.description, report.notesPublic, report.lastSeenText].filter(Boolean).join(" ") : null;
  }
  if (entityType === "tip") {
    const tip = await db.prepare("SELECT body, location_text FROM tips WHERE id = ?").bind(entityId).first<DbRow>();
    return tip ? [tip.body, tip.location_text].filter(Boolean).join(" ") : null;
  }
  return null;
}

export function moderationSuggestion(text: string, aiEnabled: boolean): Record<string, unknown> {
  const lower = text.toLowerCase();
  const flags = [
    lower.includes("dead") || lower.includes("deceased") ? "death_related_language" : null,
    lower.includes("child") || lower.includes("minor") ? "minor_related" : null,
    lower.includes("exact address") || lower.includes("home address") ? "precise_private_location" : null,
    lower.includes("phone") || lower.includes("@") ? "possible_contact_info" : null
  ].filter(Boolean);
  return {
    provider: aiEnabled ? "workers_ai_optional_not_bound" : "heuristic",
    label: flags.length ? "review_recommended" : "low_risk",
    riskFlags: flags,
    summary: text.slice(0, 240),
    humanReviewRequired: true
  };
}

export function translationDraft(text: string, locale: string, aiEnabled: boolean): Record<string, unknown> {
  return {
    provider: aiEnabled ? "workers_ai_optional_not_bound" : "heuristic",
    locale,
    draft: text,
    note: "Draft only. Review before publishing.",
    humanReviewRequired: true
  };
}

async function storeAiSuggestion(
  db: D1Database,
  actor: Actor,
  type: string,
  entityType: string | null,
  entityId: string | null,
  input: Record<string, unknown>,
  suggestion: Record<string, unknown>
): Promise<string> {
  const id = makeId("aisug");
  const timestamp = nowIso();
  await db.prepare(
    `INSERT INTO ai_suggestions (id, type, entity_type, entity_id, input_json, suggestion_json, status, created_by_user_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, type, entityType, entityId, JSON.stringify(input), JSON.stringify(suggestion), "suggested", actor.userId, timestamp, timestamp).run();
  await audit(db, { actorEmail: actor.email, action: "ai_suggestion_created", entityType: "ai_suggestion", entityId: id, after: { type, entityType, entityId } });
  return id;
}

function workflowStepForType(type: string): string {
  if (type === "report_verification") return "contact_verification";
  if (type === "organization_onboarding") return "organization_review";
  if (type === "volunteer_credential_review") return "credential_review";
  if (type === "large_import") return "import_validation";
  if (type === "retention_cleanup") return "retention_preview";
  return "processing";
}

function featureProperties(feature: Record<string, unknown>): Record<string, unknown> {
  return typeof feature.properties === "object" && feature.properties !== null ? feature.properties as Record<string, unknown> : {};
}

function featurePoint(feature: Record<string, unknown>): { lat: number; lng: number } | null {
  const geometry = typeof feature.geometry === "object" && feature.geometry !== null ? feature.geometry as Record<string, unknown> : null;
  const coordinates = Array.isArray(geometry?.coordinates) ? geometry.coordinates : null;
  if (!coordinates || typeof coordinates[0] !== "number" || typeof coordinates[1] !== "number") return null;
  return { lng: coordinates[0], lat: coordinates[1] };
}

function geometryRepresentativePoint(geometry: Record<string, unknown>): { lat: number; lng: number } | null {
  const coordinates = Array.isArray(geometry.coordinates) ? geometry.coordinates : null;
  if (!coordinates) return null;
  const point = firstCoordinatePair(coordinates);
  return point ? { lng: point[0], lat: point[1] } : null;
}

function firstCoordinatePair(value: unknown): [number, number] | null {
  if (!Array.isArray(value)) return null;
  if (typeof value[0] === "number" && typeof value[1] === "number") return [value[0], value[1]];
  for (const item of value) {
    const nested = firstCoordinatePair(item);
    if (nested) return nested;
  }
  return null;
}

function stringProp(props: Record<string, unknown>, key: string): string | null {
  const value = props[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function extractPlainEmailText(raw: string): string {
  const normalized = raw.replace(/\r\n/g, "\n");
  const split = normalized.split(/\n\n/);
  const body = split.length > 1 ? split.slice(1).join("\n\n") : normalized;
  return body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 5000) || "(empty email)";
}

function reportSlugFromSubject(subject: string | null): string | null {
  if (!subject) return null;
  const match = subject.match(/\[report:([a-z0-9-]+)\]/i);
  return match?.[1] ?? null;
}

function featureEnabled(value: string | undefined): boolean {
  return value === "true" || value === "1" || value === "yes";
}

function futureIsoDays(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function createManageToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function contactHint(value: string): string {
  if (value.includes("@")) {
    const [name, domain] = value.split("@");
    return `${name.slice(0, 2)}***@${domain}`;
  }
  return `${value.slice(0, 3)}***${value.slice(-2)}`;
}

async function applyModerationEntityStatus(db: D1Database, item: DbRow, action: "hide" | "remove"): Promise<void> {
  const entityType = String(item.entity_type);
  const entityId = String(item.entity_id);
  const timestamp = nowIso();
  if (entityType === "report") {
    await db.prepare("UPDATE reports SET moderation_status = ?, status = CASE WHEN ? = 'removed' THEN 'removed_by_request' ELSE status END, updated_at = ? WHERE id = ?")
      .bind(action === "remove" ? "removed" : "hidden", action === "remove" ? "removed" : "hidden", timestamp, entityId)
      .run();
  } else if (entityType === "tip") {
    await db.prepare("UPDATE tips SET moderation_status = ? WHERE id = ?").bind(action === "remove" ? "removed" : "hidden", entityId).run();
  } else if (entityType === "contact_message") {
    await db.prepare("UPDATE contact_messages SET moderation_status = ?, updated_at = ? WHERE id = ?").bind(action === "remove" ? "removed" : "hidden", timestamp, entityId).run();
  } else if (entityType === "abuse_report") {
    await db.prepare("UPDATE abuse_reports SET status = ?, updated_at = ? WHERE id = ?").bind(action === "remove" ? "complete" : "reviewed", timestamp, entityId).run();
  }
}

async function reportSlugById(db: D1Database, id: string): Promise<{ public_slug: string } | null> {
  return await db.prepare("SELECT public_slug FROM reports WHERE id = ?").bind(id).first<{ public_slug: string }>();
}

function rowToDuplicateCandidate(row: DbRow) {
  return {
    id: String(row.id),
    reportId: String(row.report_id),
    candidateReportId: String(row.candidate_report_id),
    score: Number(row.score ?? 0),
    reasons: typeof row.reasons_json === "string" ? parseSafeStringArray(row.reasons_json) : [],
    status: String(row.status),
    reportName: typeof row.report_name === "string" ? row.report_name : null,
    candidateName: typeof row.candidate_name === "string" ? row.candidate_name : null,
    createdAt: String(row.created_at)
  };
}

function rowToImportJob(row: DbRow) {
  return {
    id: String(row.id),
    type: String(row.type),
    status: String(row.status),
    sourceFilename: typeof row.source_filename === "string" ? row.source_filename : null,
    totalRows: Number(row.total_rows ?? 0),
    processedRows: Number(row.processed_rows ?? 0),
    errorRows: Number(row.error_rows ?? 0),
    errors: typeof row.error_json === "string" ? parseSafeStringArray(row.error_json) : [],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function rowToExportJob(row: DbRow) {
  return {
    id: String(row.id),
    type: String(row.type),
    status: String(row.status),
    rowCount: Number(row.row_count ?? 0),
    downloadUrl: row.status === "complete" ? `/api/admin/exports/${String(row.id)}/download` : null,
    error: typeof row.error === "string" ? row.error : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function rowToVolunteer(row: DbRow) {
  return {
    id: String(row.id),
    name: String(row.name),
    location: typeof row.location === "string" ? row.location : null,
    skills: typeof row.skills === "string" ? row.skills : null,
    languages: typeof row.languages === "string" ? row.languages : null,
    availability: typeof row.availability === "string" ? row.availability : null,
    status: String(row.status),
    assignedOrganizationId: typeof row.assigned_organization_id === "string" ? row.assigned_organization_id : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function rowToDataRequest(row: DbRow) {
  return {
    id: String(row.id),
    type: String(row.type),
    reportId: typeof row.report_id === "string" ? row.report_id : null,
    details: typeof row.details === "string" ? row.details : null,
    status: String(row.status),
    resultUrl: typeof row.result_bucket_key === "string" ? `/api/admin/data-requests/${String(row.id)}/download` : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function rowToOrganizationApplication(row: DbRow) {
  return {
    id: String(row.id),
    name: String(row.name),
    type: String(row.type),
    description: typeof row.description === "string" ? row.description : null,
    website: typeof row.website === "string" ? row.website : null,
    contactPublic: typeof row.contact_public === "string" ? row.contact_public : null,
    verificationEvidence: typeof row.verification_evidence === "string" ? row.verification_evidence : null,
    status: String(row.status),
    createdOrganizationId: typeof row.created_organization_id === "string" ? row.created_organization_id : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function rowToMapLayer(row: DbRow): MapLayer {
  return {
    id: String(row.id),
    type: String(row.type),
    label: String(row.label),
    description: typeof row.description === "string" ? row.description : null,
    geometry: parseSafeObject(typeof row.geometry_json === "string" ? row.geometry_json : "{}"),
    status: String(row.status),
    visibility: String(row.visibility),
    verificationLevel: String(row.verification_level ?? "unverified") as VerificationLevel,
    organizationId: typeof row.organization_id === "string" ? row.organization_id : null,
    sourceUrl: typeof row.source_url === "string" ? row.source_url : null,
    updatedAt: String(row.updated_at)
  };
}

function rowToMapLayerFeature(row: DbRow) {
  const layer = rowToMapLayer(row);
  const point = geometryRepresentativePoint(layer.geometry);
  return {
    id: layer.id,
    type: "layer",
    label: layer.label,
    category: layer.type,
    status: layer.status,
    locationLabel: layer.description,
    lat: point?.lat ?? null,
    lng: point?.lng ?? null,
    geometry: layer.geometry,
    precision: layer.visibility,
    url: `/map?type=layer&id=${layer.id}`,
    verificationLevel: layer.verificationLevel,
    updatedAt: layer.updatedAt
  };
}

function rowToResourceTranslation(row: DbRow) {
  return {
    id: String(row.id),
    resourceId: String(row.resource_id),
    locale: String(row.locale),
    name: typeof row.name === "string" ? row.name : null,
    description: typeof row.description === "string" ? row.description : null,
    services: typeof row.services === "string" ? row.services : null,
    currentNeeds: typeof row.current_needs === "string" ? row.current_needs : null,
    updatedAt: String(row.updated_at)
  };
}

function rowToLocaleOverride(row: DbRow) {
  return {
    id: String(row.id),
    locale: String(row.locale),
    namespace: String(row.namespace),
    key: String(row.key),
    value: String(row.value),
    updatedAt: String(row.updated_at)
  };
}

function rowToVolunteerAssignment(row: DbRow) {
  return {
    id: String(row.id),
    volunteerId: String(row.volunteer_id),
    organizationId: typeof row.organization_id === "string" ? row.organization_id : null,
    taskLabel: String(row.task_label),
    status: String(row.status),
    notesPrivate: typeof row.notes_private === "string" ? row.notes_private : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function rowToReportChangeRequest(row: DbRow) {
  return {
    id: String(row.id),
    reportId: String(row.report_id),
    changeType: String(row.change_type),
    oldValue: parseSafeObject(typeof row.old_json === "string" ? row.old_json : "{}"),
    newValue: parseSafeObject(typeof row.new_json === "string" ? row.new_json : "{}"),
    reason: typeof row.reason === "string" ? row.reason : null,
    status: String(row.status),
    reviewerNote: typeof row.reviewer_note === "string" ? row.reviewer_note : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function rowToMediaReviewItem(row: DbRow) {
  return {
    id: String(row.id),
    type: String(row.type),
    mimeType: String(row.mime_type),
    altText: typeof row.alt_text === "string" ? row.alt_text : null,
    moderationStatus: String(row.moderation_status),
    riskFlags: typeof row.risk_flags_json === "string" ? parseSafeStringArray(row.risk_flags_json) : [],
    reviewedAt: typeof row.reviewed_at === "string" ? row.reviewed_at : null,
    reviewNote: typeof row.review_note === "string" ? row.review_note : null,
    createdAt: String(row.created_at)
  };
}

function rowToPartnerApiClient(row: DbRow) {
  return {
    id: String(row.id),
    name: String(row.name),
    scopes: typeof row.scopes_json === "string" ? parsePartnerScopes(row.scopes_json) : [],
    status: String(row.status),
    lastUsedAt: typeof row.last_used_at === "string" ? row.last_used_at : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function parsePartnerScopes(value: string): PartnerApiScope[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(isPartnerApiScope) : [];
  } catch {
    return [];
  }
}

function isPartnerApiScope(value: unknown): value is PartnerApiScope {
  return [
    "reports:read",
    "pets:read",
    "resources:read",
    "updates:read",
    "organizations:read",
    "map:read"
  ].includes(String(value));
}

function reportChangeRequiresReview(report: PublicReport, change: Record<string, unknown>): boolean {
  const nextStatus = typeof change.status === "string" ? change.status : null;
  if (nextStatus && ["deceased_unconfirmed", "deceased_verified", "in_hospital", "in_shelter"].includes(nextStatus)) return true;
  if (change.mediaAssetId) return true;
  if (typeof change.lastSeenLat === "number" || typeof change.lastSeenLng === "number" || change.locationPrecision === "exact") return true;
  if (change.removePublicContact && report.publicContactValue) return true;
  return false;
}

async function approveReportChangeRequest(db: D1Database, changeRequestId: string, actor: Actor): Promise<void> {
  const row = await db.prepare("SELECT * FROM report_change_requests WHERE id = ?").bind(changeRequestId).first<DbRow>();
  if (!row) return;
  const change = parseSafeObject(typeof row.new_json === "string" ? row.new_json : "{}");
  const timestamp = nowIso();
  await db.prepare(
    `UPDATE reports
     SET status = COALESCE(?, status),
         notes_public = COALESCE(?, notes_public),
         last_seen_text = COALESCE(?, last_seen_text),
         last_seen_city = COALESCE(?, last_seen_city),
         last_seen_admin1 = COALESCE(?, last_seen_admin1),
         last_seen_lat = COALESCE(?, last_seen_lat),
         last_seen_lng = COALESCE(?, last_seen_lng),
         location_precision = COALESCE(?, location_precision),
         primary_media_asset_id = COALESCE(?, primary_media_asset_id),
         public_contact_type = CASE WHEN ? IS NOT NULL THEN NULL ELSE public_contact_type END,
         public_contact_value = CASE WHEN ? IS NOT NULL THEN NULL ELSE public_contact_value END,
         updated_at = ?
     WHERE id = ?`
  ).bind(
    typeof change.status === "string" ? change.status : null,
    typeof change.notesPublic === "string" ? change.notesPublic : null,
    typeof change.lastSeenText === "string" ? change.lastSeenText : null,
    typeof change.lastSeenCity === "string" ? change.lastSeenCity : null,
    typeof change.lastSeenAdmin1 === "string" ? change.lastSeenAdmin1 : null,
    typeof change.lastSeenLat === "number" ? change.lastSeenLat : null,
    typeof change.lastSeenLng === "number" ? change.lastSeenLng : null,
    typeof change.locationPrecision === "string" ? change.locationPrecision : null,
    typeof change.mediaAssetId === "string" ? change.mediaAssetId : null,
    change.removePublicContact === true ? "yes" : null,
    change.removePublicContact === true ? "yes" : null,
    timestamp,
    String(row.report_id)
  ).run();
  if (typeof change.mediaAssetId === "string") {
    await db.prepare("UPDATE media_assets SET moderation_status = 'published', reviewed_by_user_id = ?, reviewed_at = ?, review_note = ? WHERE id = ?")
      .bind(actor.userId, timestamp, "Approved with reporter change request", change.mediaAssetId)
      .run();
  }
  await db.prepare("UPDATE report_change_requests SET status = 'approved', reviewer_note = ?, updated_at = ? WHERE id = ?")
    .bind("Approved", timestamp, changeRequestId)
    .run();
}

async function requirePartnerScope(db: D1Database, request: Request, scope: PartnerApiScope): Promise<{ clientId: string } | Response> {
  const header = request.headers.get("authorization") ?? "";
  const bearer = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  const token = bearer || request.headers.get("x-emergos-api-token") || "";
  if (!token) return badRequest("Partner API token is required.", 401);
  const tokenHash = await hashValue(token);
  const row = await db.prepare("SELECT * FROM partner_api_clients WHERE token_hash = ? AND status = 'active'").bind(tokenHash).first<DbRow>();
  if (!row) return badRequest("Partner API token is invalid.", 401);
  const scopes = parsePartnerScopes(String(row.scopes_json ?? "[]"));
  if (!scopes.includes(scope)) return badRequest("Partner API scope is not allowed.", 403);
  await db.prepare("UPDATE partner_api_clients SET last_used_at = ?, updated_at = ? WHERE id = ?").bind(nowIso(), nowIso(), String(row.id)).run();
  return { clientId: String(row.id) };
}

function v1List<T>(data: T[]) {
  return { data, nextCursor: null, generatedAt: nowIso() };
}

function partnerOpenApiSpec() {
  return {
    openapi: "3.1.0",
    info: { title: "emergOS Partner API", version: "1.0.0" },
    security: [{ bearerAuth: [] }],
    components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } } },
    paths: {
      "/api/v1/reports": { get: { summary: "List public person reports" } },
      "/api/v1/pets": { get: { summary: "List public pet reports" } },
      "/api/v1/resources": { get: { summary: "List public resources" } },
      "/api/v1/organizations": { get: { summary: "List verified organizations" } },
      "/api/v1/updates": { get: { summary: "List public updates" } },
      "/api/v1/map-features": { get: { summary: "List public-safe map features" } }
    }
  };
}

function flyerFormat(value: string | undefined, report: PublicReport): string {
  if (value === "a5" || value === "mini4" || value === "poster" || value === "pet") return value;
  return report.subjectType === "pet" ? "pet" : "a4";
}

function parseSafeStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function parseSafeObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function parseReportForm(form: FormData):
  | { error: string }
  | {
      type: ReportType;
      displayName: string;
      age: number | null;
      ageRange: string | null;
      description: string | null;
      medicalNotesPrivate: string | null;
      status: ReportStatus;
      lastSeenAt: string | null;
      lastSeenText: string;
      lastSeenAdmin1: string | null;
      lastSeenCity: string | null;
      lastSeenLat: number | null;
      lastSeenLng: number | null;
      locationPrecision: string;
      reporterName: string | null;
      reporterContact: string | null;
      publicContactType: string | null;
      publicContactValue: string | null;
      contactMode: ContactMode;
      notesPublic: string | null;
      notesPrivate: string | null;
    } {
  const type = textField(form, "type") as ReportType;
  const displayName = textField(form, "displayName");
  const lastSeenText = textField(form, "lastSeenText");
  const contactMode = (textField(form, "contactMode") || textField(form, "contactModeChoice") || "protected_form") as ContactMode;

  if (!["missing_person", "found_person", "missing_pet", "found_pet"].includes(type)) return { error: "Invalid report type." };
  if (!displayName || displayName.length < 2) return { error: "Name or description is required." };
  if (!lastSeenText || lastSeenText.length < 2) return { error: "Last seen area is required." };
  if (!["public_direct", "protected_form", "organization_mediated"].includes(contactMode)) return { error: "Invalid contact mode." };

  const ageRaw = textField(form, "age");
  const age = ageRaw ? Number(ageRaw) : null;
  if (age !== null && (!Number.isInteger(age) || age < 0 || age > 130)) return { error: "Age must be a valid number." };
  const lastSeenLat = numberField(form, "lastSeenLat");
  const lastSeenLng = numberField(form, "lastSeenLng");
  if ((lastSeenLat === null) !== (lastSeenLng === null)) return { error: "Latitude and longitude must be provided together." };
  if (!validLatLng(lastSeenLat, lastSeenLng)) return { error: "Coordinates are invalid." };

  return {
    type,
    displayName,
    age,
    ageRange: textField(form, "ageRange"),
    description: textField(form, "description"),
    medicalNotesPrivate: textField(form, "medicalNotesPrivate"),
    status: (textField(form, "status") as ReportStatus) || (type === "missing_person" || type === "missing_pet" ? "missing" : "found_needs_help"),
    lastSeenAt: textField(form, "lastSeenAt"),
    lastSeenText,
    lastSeenAdmin1: textField(form, "lastSeenAdmin1"),
    lastSeenCity: textField(form, "lastSeenCity"),
    lastSeenLat,
    lastSeenLng,
    locationPrecision: textField(form, "locationPrecision") || "area",
    reporterName: textField(form, "reporterName"),
    reporterContact: textField(form, "reporterContact"),
    publicContactType: textField(form, "publicContactType"),
    publicContactValue: textField(form, "publicContactValue"),
    contactMode,
    notesPublic: textField(form, "notesPublic"),
    notesPrivate: textField(form, "notesPrivate")
  };
}

function textField(form: FormData, key: string): string | null {
  const value = form.get(key);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function numberField(form: FormData, key: string): number | null {
  const value = textField(form, key);
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function bodyNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function validLatLng(lat: number | null, lng: number | null): boolean {
  if (lat === null && lng === null) return true;
  if (lat === null || lng === null) return false;
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

function isRole(value: string): value is Role {
  return [
    "owner",
    "admin",
    "moderator",
    "verifier",
    "organization_manager",
    "volunteer_coordinator",
    "read_only_observer"
  ].includes(value);
}

async function uploadImage(
  env: Env,
  form: FormData,
  ownerId: string,
  type: "report" | "tip",
  moderationStatus: string
): Promise<{ assetId: string | null } | { error: Response }> {
  const file = form.get("photo");
  if (!(file instanceof File) || file.size === 0) return { assetId: null };
  if (!allowedImageTypes.has(file.type)) return { error: badRequest("Only JPEG, PNG, or WebP images are allowed.") };
  if (file.size > 5 * 1024 * 1024) return { error: badRequest("Images must be 5 MB or smaller.", 413) };

  const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const assetId = makeId("media");
  const key = `${type}s/${ownerId}/${assetId}.${extension}`;
  await env.MEDIA.put(key, file.stream(), {
    httpMetadata: {
      contentType: file.type
    },
    customMetadata: {
      ownerId,
      type
    }
  });
  await env.DB.prepare(
    "INSERT INTO media_assets (id, bucket_key, type, mime_type, alt_text, moderation_status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(assetId, key, type === "report" ? "report_photo" : "tip_photo", file.type, file.name || null, moderationStatus, nowIso())
    .run();
  return { assetId };
}

async function createModerationItem(db: D1Database, entityType: string, entityId: string, reason: string, riskFlags: string[]): Promise<void> {
  const timestamp = nowIso();
  await db
    .prepare(
      "INSERT INTO moderation_items (id, entity_type, entity_id, reason, risk_flags_json, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(makeId("mod"), entityType, entityId, reason, JSON.stringify(riskFlags), "open", timestamp, timestamp)
    .run();
}

async function findReportBySlug(db: D1Database, slug: string): Promise<PublicReport> {
  const row = await db
    .prepare(
      `SELECT
         r.*,
         COALESCE(p.display_name, pet.name) AS display_name,
         p.age AS age,
         COALESCE(p.age_range, pet.species) AS age_range,
         COALESCE(p.description, pet.notes_public, pet.markings) AS description,
         pet.name AS pet_name,
         pet.species AS pet_species,
         pet.breed AS pet_breed,
         pet.color AS pet_color,
         pet.markings AS pet_markings
       FROM reports r
       LEFT JOIN people p ON p.id = r.person_id
       LEFT JOIN pets pet ON pet.id = r.pet_id
       WHERE r.public_slug = ?`
    )
    .bind(slug)
    .first<DbRow>();
  if (!row) throw new Error("Report not found after write");
  return rowToReport(row);
}

function filterDemoReports({ query, status, type }: { query?: string; status?: string; type?: string }): PublicReport[] {
  const normalizedQuery = query ? normalizeText(query) : "";
  return demoReports.filter((report) => {
    if (type && report.type !== type) return false;
    if (status && report.status !== status) return false;
    if (!normalizedQuery) return true;
    const searchable = normalizeText([
      report.displayName,
      report.lastSeenCity,
      report.lastSeenAdmin1,
      report.lastSeenText,
      report.notesPublic
    ].filter(Boolean).join(" "));
    return searchable.includes(normalizedQuery);
  });
}

function findDemoReport(slug: string): PublicReport | null {
  return demoReports.find((report) => report.publicSlug === slug) ?? null;
}

async function ensureDemoReportPersisted(db: D1Database, report: PublicReport): Promise<PublicReport> {
  const existing = await findPublicReport(db, report.publicSlug);
  if (existing) return existing;

  const personId = `person_${report.id}`;
  await db.prepare(
    `INSERT OR IGNORE INTO people (
      id, display_name, normalized_name, age, age_range, gender, description, medical_notes_private, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      personId,
      report.displayName,
      normalizeText(report.displayName),
      report.age,
      report.ageRange,
      null,
      report.description,
      null,
      report.createdAt,
      report.updatedAt
    )
    .run();

  await db.prepare(
    `INSERT OR IGNORE INTO reports (
      id, type, person_id, status, verification_level, public_slug, primary_media_asset_id,
      last_seen_at, last_seen_text, last_seen_admin1, last_seen_city, location_precision,
      reporter_name, reporter_contact_private, public_contact_type, public_contact_value,
      public_contact_consent_at, contact_mode, notes_public, notes_private, source_type,
      moderation_status, risk_flags_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      report.id,
      report.type,
      personId,
      report.status,
      report.verificationLevel,
      report.publicSlug,
      null,
      report.lastSeenAt,
      report.lastSeenText,
      report.lastSeenAdmin1,
      report.lastSeenCity,
      report.locationPrecision,
      null,
      JSON.stringify({ contact: null }),
      report.publicContactType,
      report.publicContactValue,
      null,
      report.contactMode,
      report.notesPublic,
      null,
      "community",
      "published",
      JSON.stringify(report.riskFlags),
      report.createdAt,
      report.updatedAt
    )
    .run();

  return await findPublicReport(db, report.publicSlug) ?? report;
}

const demoReports: PublicReport[] = [
  makeDemoReport("demo_maria_rojas", "maria-rojas-demo", "Maria Rojas", "Petare", "Last seen near a family shelter after the earthquake", "Wearing a blue jacket and carrying a small black backpack.", 55),
  makeDemoReport("demo_lucia_perez", "lucia-perez-demo", "Lucia Perez", "Chacao", "Separated from relatives during evacuation", "May be looking for transport toward eastern Caracas.", 38),
  makeDemoReport("demo_elena_castillo", "elena-castillo-demo", "Elena Castillo", "La Candelaria", "Reported near a medical triage point", "Family says she may need blood pressure medication.", 63),
  makeDemoReport("demo_sofia_mendoza", "sofia-mendoza-demo", "Sofia Mendoza", "Catia", "Last seen walking toward the metro station", "Community report, details still being verified.", 29),
  makeDemoReport("demo_ana_garcia", "ana-garcia-demo", "Ana Garcia", "Altamira", "Separated from neighbors during aftershock", "Likely trying to reach relatives in Caracas.", 44)
];

function demoPublicUpdates(): PublicUpdate[] {
  return [
    {
      id: "demo_update_shelters",
      title: "Shelter intake and triage points updated",
      body: "Community shelter and hospital intake information is being reviewed continuously. Confirm capacity before sending people to a listed site.",
      type: "resource_update",
      source: "emergOS demo operations",
      verificationLevel: "contact_verified",
      locale: "en",
      pinned: true,
      publishedAt: "2026-06-27T18:00:00.000Z"
    },
    {
      id: "demo_update_map",
      title: "Map locations are approximate unless marked exact",
      body: "Reports marked as area or city only should not be treated as precise locations. Hidden map records are intentionally excluded from the public map.",
      type: "map_notice",
      source: "emergOS demo operations",
      verificationLevel: "org_verified",
      locale: "en",
      pinned: false,
      publishedAt: "2026-06-27T17:30:00.000Z"
    }
  ];
}

function demoOrganizations(): PublicOrganization[] {
  return [
    {
      id: "demo_org_response_network",
      name: "Caracas Response Network",
      type: "volunteer_group",
      description: "Demo verified organization coordinating shelter checks, resource updates, and family reunification support.",
      website: "https://emergos.org/",
      contactPublic: "ops@example.org",
      verificationStatus: "org_verified",
      updatedAt: "2026-06-27T18:00:00.000Z"
    }
  ];
}

function demoOrganizationResources(organizationId: string): PublicResource[] {
  if (organizationId !== "demo_org_response_network") return [];
  return [
    {
      id: "demo_resource_chacao_shelter",
      type: "shelter",
      name: "Centro Comunitario Chacao",
      description: "Demo shelter listing for local development and UI review.",
      address: "Chacao",
      admin1: "Distrito Capital",
      city: "Caracas",
      hours: "Open until 20:00",
      capacity: "Medium",
      availabilityStatus: "open",
      contactPublic: "Community desk",
      sourceUrl: "https://emergos.org/",
      verificationLevel: "contact_verified",
      lat: 10.4927,
      lng: -66.8568,
      locationPrecision: "area",
      organizationId,
      lastVerifiedAt: "2026-06-27T18:00:00.000Z",
      updatedAt: "2026-06-27T18:00:00.000Z"
    }
  ];
}

function makeDemoReport(id: string, slug: string, name: string, city: string, lastSeenText: string, notesPublic: string, age: number): PublicReport {
  const timestamp = "2026-06-27T17:00:00.000Z";
  return {
    id,
    type: "missing_person",
    displayName: name,
    age,
    ageRange: null,
    description: notesPublic,
    status: "missing",
    verificationLevel: "unverified",
    publicSlug: slug,
    photoUrl: "/person-female-example.jpeg",
    lastSeenAt: null,
    lastSeenText,
    lastSeenAdmin1: null,
    lastSeenCity: city,
    locationPrecision: "area",
    contactMode: "protected_form",
    publicContactType: null,
    publicContactValue: null,
    notesPublic,
    moderationStatus: "published",
    riskFlags: [],
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

function demoMapFeatures() {
  return [
    {
      id: "demo-map-resource-hospital",
      type: "resource",
      label: "Hospital Clinico Universitario",
      category: "hospital",
      status: "open",
      locationLabel: "Caracas",
      lat: 10.4903,
      lng: -66.8914,
      precision: "exact",
      url: "/resources",
      verificationLevel: "contact_verified",
      updatedAt: "2026-06-27T17:00:00.000Z"
    },
    {
      id: "demo-map-resource-shelter",
      type: "resource",
      label: "Centro Comunitario Chacao",
      category: "shelter",
      status: "open",
      locationLabel: "Chacao",
      lat: 10.4927,
      lng: -66.8568,
      precision: "area",
      url: "/resources",
      verificationLevel: "contact_verified",
      updatedAt: "2026-06-27T17:00:00.000Z"
    },
    {
      id: "demo_maria_rojas",
      type: "report",
      label: "Maria Rojas",
      category: "missing_person",
      status: "missing",
      locationLabel: "Petare",
      lat: 10.4778,
      lng: -66.8015,
      precision: "area",
      url: "/reports/maria-rojas-demo",
      verificationLevel: "unverified",
      updatedAt: "2026-06-27T17:00:00.000Z"
    },
    {
      id: "demo_lucia_perez",
      type: "report",
      label: "Lucia Perez",
      category: "missing_person",
      status: "missing",
      locationLabel: "Chacao",
      lat: 10.4958,
      lng: -66.8536,
      precision: "area",
      url: "/reports/lucia-perez-demo",
      verificationLevel: "unverified",
      updatedAt: "2026-06-27T17:00:00.000Z"
    }
  ];
}

async function findPublicReport(db: D1Database, slug: string): Promise<PublicReport | null> {
  const row = await db
    .prepare(
      `SELECT
         r.*,
         COALESCE(p.display_name, pet.name) AS display_name,
         p.age AS age,
         COALESCE(p.age_range, pet.species) AS age_range,
         COALESCE(p.description, pet.notes_public, pet.markings) AS description,
         pet.name AS pet_name,
         pet.species AS pet_species,
         pet.breed AS pet_breed,
         pet.color AS pet_color,
         pet.markings AS pet_markings
       FROM reports r
       LEFT JOIN people p ON p.id = r.person_id
       LEFT JOIN pets pet ON pet.id = r.pet_id
       WHERE r.public_slug = ? AND r.moderation_status = 'published'`
    )
    .bind(slug)
    .first<DbRow>();
  return row ? rowToReport(row) : null;
}

async function count(db: D1Database, sql: string, ...params: unknown[]): Promise<number> {
  const statement = db.prepare(sql);
  const row = params.length ? await statement.bind(...params).first<{ count: number }>() : await statement.first<{ count: number }>();
  return row?.count ?? 0;
}

function renderFlyer(report: PublicReport, url: string, qrSvg: string, format = "a4"): string {
  const contact = report.publicContactValue ? `${report.publicContactType}: ${report.publicContactValue}` : "Use protected contact form on the QR page";
  const isPet = report.subjectType === "pet";
  const subjectLabel = isPet ? "Pet" : "Name";
  const ageLabel = isPet ? "Species" : "Age";
  const lastSeenLabel = report.type === "found_person" || report.type === "found_pet" ? "Found" : "Last seen";
  const pageSize = format === "a5" ? "A5" : format === "mini4" ? "A6" : "A4";
  const isPoster = format === "poster";
  const isMini = format === "mini4";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(report.displayName)} flyer</title>
  <style>
    :root { --ink: #111827; --red: #C91525; --muted: #4B5563; }
    * { box-sizing: border-box; }
    body {
      background: #f3f4f6;
      color: var(--ink);
      font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      margin: 0;
      padding: 20px;
    }
    .sheet {
      display: grid;
      gap: 12px;
      grid-template-columns: ${isMini ? "repeat(2, minmax(0, 1fr))" : "1fr"};
      margin: 0 auto;
      max-width: ${isMini ? "920px" : "820px"};
    }
    .flyer {
      background: #ffffff;
      border: 6px solid var(--ink);
      display: grid;
      gap: ${isPoster ? "26px" : "18px"};
      padding: 22px;
      page-break-inside: avoid;
    }
    .header {
      align-items: start;
      border-bottom: 4px solid var(--ink);
      display: flex;
      gap: 18px;
      justify-content: space-between;
      padding-bottom: 14px;
    }
    .status {
      color: var(--red);
      font-size: 20px;
      font-weight: 900;
      letter-spacing: 0;
      margin-bottom: 4px;
      text-transform: uppercase;
    }
    h1 {
      font-size: clamp(42px, 7vw, 62px);
      line-height: 0.95;
      margin: 0;
    }
    .print-action {
      align-items: center;
      background: var(--red);
      border: 0;
      border-radius: 6px;
      color: #ffffff;
      cursor: pointer;
      display: inline-flex;
      font: inherit;
      font-weight: 800;
      gap: 8px;
      min-height: 44px;
      padding: 10px 14px;
    }
    .print-action svg { height: 22px; width: 22px; }
    .content {
      align-items: start;
      display: grid;
      gap: 18px;
      grid-template-columns: minmax(0, 1fr) 178px;
    }
    .photo {
      align-items: center;
      background: #f8fafc;
      display: flex;
      height: 360px;
      justify-content: center;
      overflow: hidden;
    }
    .photo img {
      height: 100%;
      object-fit: contain;
      width: 100%;
    }
    .photo span {
      color: var(--muted);
      font-size: 22px;
      font-weight: 800;
      text-align: center;
    }
    .qr-block {
      display: grid;
      gap: 10px;
    }
    .qr {
      border: 3px solid var(--ink);
      padding: 8px;
    }
    .qr svg {
      display: block;
      height: auto;
      width: 100%;
    }
    .qr-caption {
      color: var(--muted);
      font-size: 13px;
      line-height: 1.35;
      margin: 0;
    }
    .details {
      border-top: 3px solid var(--ink);
      display: grid;
      font-size: 22px;
      gap: 8px;
      padding-top: 14px;
    }
    .label { font-weight: 900; }
    .footer {
      border-top: 3px solid var(--ink);
      color: var(--muted);
      font-size: 15px;
      line-height: 1.35;
      padding-top: 10px;
      word-break: break-word;
    }
    @page {
      margin: 8mm;
      size: ${pageSize};
    }
    @media print {
      html,
      body {
        background: #ffffff;
        height: auto;
        padding: 0;
        width: auto;
      }
      .print-action {
        display: none !important;
      }
      .sheet {
        grid-template-columns: ${isMini ? "repeat(2, 1fr)" : "1fr"};
        max-width: none;
      }
      .flyer {
        border-width: 2mm;
        gap: 5mm;
        max-width: none;
        padding: 5mm;
        width: 100%;
      }
      .header {
        border-bottom-width: 1.2mm;
        padding-bottom: 4mm;
      }
      .status {
        font-size: 15pt;
      }
      h1 {
        font-size: 38pt;
      }
      .content {
        gap: 5mm;
        grid-template-columns: minmax(0, 1fr) 40mm;
      }
      .photo {
        height: 110mm;
      }
      .qr {
        border-width: 1mm;
        padding: 2mm;
      }
      .qr-caption {
        font-size: 9pt;
      }
      .details {
        border-top-width: 1mm;
        font-size: 14pt;
        gap: 2mm;
        padding-top: 4mm;
      }
      .footer {
        border-top-width: 1mm;
        font-size: 10pt;
        padding-top: 3mm;
      }
    }
  </style>
</head>
<body>
  <main class="sheet">
  ${Array.from({ length: isMini ? 4 : 1 }).map(() => `
  <article class="flyer">
    <section class="header">
      <div>
        <div class="status">${escapeHtml(report.status.replaceAll("_", " "))}</div>
        <h1>${escapeHtml(report.displayName)}</h1>
      </div>
      <button class="print-action" onclick="window.print()" aria-label="Print flyer">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M17 17H18.6667C19.9128 17 20.5359 17 21 16.7321C21.304 16.5565 21.5565 16.304 21.732 16C22 15.5359 22 14.9128 22 13.6667C22 11.1744 22 9.9282 21.4641 9C21.113 8.39192 20.6081 7.88697 20 7.5359C19.0718 7 17.8256 7 15.3333 7H8.66667C6.17436 7 4.9282 7 4 7.5359C3.39192 7.88697 2.88697 8.39192 2.5359 9C2 9.9282 2 11.1744 2 13.6667C2 14.9128 2 15.5359 2.26795 16C2.44349 16.304 2.69596 16.5565 3 16.7321C3.4641 17 4.08718 17 5.33333 17H7"></path>
          <path d="M17 7V5C17 3.58579 17 2.87868 16.5607 2.43934C16.1213 2 15.4142 2 14 2H10C8.58579 2 7.87868 2 7.43934 2.43934C7 2.87868 7 3.58579 7 5V7"></path>
          <path d="M17 14V19C17 20.4142 17 21.1213 16.5607 21.5607C16.1213 22 15.4142 22 14 22H10C8.58579 22 7.87868 22 7.43934 21.5607C7 21.1213 7 20.4142 7 19V14H17Z"></path>
          <path d="M18.8748 10.25H18.7498M18.9998 10.25C18.9998 10.3881 18.8879 10.5 18.7498 10.5C18.6117 10.5 18.4998 10.3881 18.4998 10.25C18.4998 10.1119 18.6117 10 18.7498 10C18.8879 10 18.9998 10.1119 18.9998 10.25Z"></path>
        </svg>
        Print
      </button>
    </section>
    <section class="content">
      <div class="photo">${report.photoUrl ? `<img src="${escapeHtml(report.photoUrl)}" alt="${escapeHtml(report.displayName)}">` : "<span>No photo provided</span>"}</div>
      <aside class="qr-block">
        <div class="qr">${qrSvg}</div>
        <p class="qr-caption">Scan for current status, tips, and contact options.</p>
      </aside>
    </section>
    <section class="details">
      <div><span class="label">${subjectLabel}:</span> ${escapeHtml(report.displayName)}</div>
      <div><span class="label">${ageLabel}:</span> ${escapeHtml(String(report.ageRange ?? report.age ?? "Unknown"))}</div>
      <div><span class="label">${lastSeenLabel}:</span> ${escapeHtml(report.lastSeenText ?? "Unknown")}</div>
      <div><span class="label">Area:</span> ${escapeHtml([report.lastSeenCity, report.lastSeenAdmin1].filter(Boolean).join(", ") || "Unknown")}</div>
      <div><span class="label">Contact:</span> ${escapeHtml(contact)}</div>
      <div><span class="label">Verification:</span> ${escapeHtml(report.verificationLevel.replaceAll("_", " "))}</div>
    </section>
    <section class="footer">
      Scan the QR code or visit ${escapeHtml(url)}. Information may change quickly.
    </section>
  </article>`).join("")}
  </main>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return char;
    }
  });
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&apos;";
      default:
        return char;
    }
  });
}
