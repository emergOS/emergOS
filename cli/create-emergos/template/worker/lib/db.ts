import type {
  ContactMode,
  ModerationStatus,
  PublicReport,
  PublicOrganization,
  PublicResource,
  PublicUpdate,
  ReportStatus,
  ReportType,
  ResourceType,
  VerificationLevel
} from "../../src/lib/contracts";

export type DbRow = Record<string, unknown>;

export function nowIso(): string {
  return new Date().toISOString();
}

export function makeId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function normalizeText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

export function slugify(value: string, id: string): string {
  const base = normalizeText(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `${base || "report"}-${id.slice(-8)}`;
}

export function parseJsonArray(value: unknown): string[] {
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function numberOrNull(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

export function rowToReport(row: DbRow): PublicReport {
  const publicSlug = String(row.public_slug);
  const displayName = String(row.display_name ?? row.subject_name ?? "Unknown");
  const demoPhotoUrl = publicSlug.startsWith("maria-test-") || publicSlug.endsWith("-demo") || displayName === "Maria Test" ? "/person-female-example.jpeg" : null;
  const isPet = String(row.type) === "missing_pet" || String(row.type) === "found_pet";

  return {
    id: String(row.id),
    type: String(row.type) as ReportType,
    displayName,
    age: numberOrNull(row.age),
    ageRange: stringOrNull(row.age_range),
    description: stringOrNull(row.description),
    subjectType: isPet ? "pet" : "person",
    pet: isPet ? {
      name: stringOrNull(row.pet_name ?? row.display_name),
      species: stringOrNull(row.pet_species ?? row.age_range),
      breed: stringOrNull(row.pet_breed),
      color: stringOrNull(row.pet_color),
      markings: stringOrNull(row.pet_markings ?? row.description)
    } : null,
    status: String(row.status) as ReportStatus,
    verificationLevel: String(row.verification_level) as VerificationLevel,
    publicSlug,
    photoUrl: row.primary_media_asset_id ? `/media/${String(row.primary_media_asset_id)}` : demoPhotoUrl,
    lastSeenAt: stringOrNull(row.last_seen_at),
    lastSeenText: stringOrNull(row.last_seen_text),
    lastSeenAdmin1: stringOrNull(row.last_seen_admin1),
    lastSeenCity: stringOrNull(row.last_seen_city),
    lastSeenLat: numberOrNull(row.last_seen_lat),
    lastSeenLng: numberOrNull(row.last_seen_lng),
    locationPrecision: String(row.location_precision ?? "area"),
    contactMode: String(row.contact_mode ?? "protected_form") as ContactMode,
    publicContactType: stringOrNull(row.public_contact_type),
    publicContactValue: stringOrNull(row.public_contact_value),
    notesPublic: stringOrNull(row.notes_public),
    moderationStatus: String(row.moderation_status) as ModerationStatus,
    riskFlags: parseJsonArray(row.risk_flags_json),
    duplicateOfReportId: stringOrNull(row.duplicate_of_report_id),
    assignedOrganizationId: stringOrNull(row.assigned_organization_id),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

export function rowToResource(row: DbRow): PublicResource {
  return {
    id: String(row.id),
    type: String(row.type) as ResourceType,
    name: String(row.name),
    description: stringOrNull(row.description),
    address: stringOrNull(row.address),
    admin1: stringOrNull(row.admin1),
    city: stringOrNull(row.city),
    hours: stringOrNull(row.hours),
    capacity: stringOrNull(row.capacity),
    availabilityStatus: String(row.availability_status ?? "unknown"),
    contactPublic: stringOrNull(row.contact_public),
    sourceUrl: stringOrNull(row.source_url),
    donationUrl: String(row.donation_verification_status ?? "none") === "verified" ? stringOrNull(row.donation_url) : null,
    donationVerificationStatus: stringOrNull(row.donation_verification_status),
    donationVerifiedAt: stringOrNull(row.donation_verified_at),
    protectedLocation: Number(row.protected_location ?? 0) === 1,
    acceptedGroups: stringOrNull(row.accepted_groups),
    accessibility: stringOrNull(row.accessibility),
    supplies: stringOrNull(row.supplies),
    currentNeeds: stringOrNull(row.current_needs),
    services: stringOrNull(row.services),
    verificationLevel: String(row.verification_level ?? "unverified") as VerificationLevel,
    lat: numberOrNull(row.lat),
    lng: numberOrNull(row.lng),
    locationPrecision: String(row.location_precision ?? "area"),
    organizationId: stringOrNull(row.organization_id),
    lastVerifiedAt: stringOrNull(row.last_verified_at),
    verificationDueAt: stringOrNull(row.verification_due_at),
    updatedAt: String(row.updated_at)
  };
}

export function rowToUpdate(row: DbRow): PublicUpdate {
  return {
    id: String(row.id),
    title: String(row.title),
    body: String(row.body),
    type: String(row.type ?? "situation_update"),
    source: stringOrNull(row.source),
    verificationLevel: String(row.verification_level ?? "unverified") as VerificationLevel,
    locale: String(row.locale ?? "en"),
    pinned: Number(row.pinned ?? 0) === 1,
    publishedAt: String(row.published_at)
  };
}

export function rowToOrganization(row: DbRow): PublicOrganization {
  return {
    id: String(row.id),
    name: String(row.name),
    type: String(row.type),
    description: stringOrNull(row.description),
    website: stringOrNull(row.website),
    contactPublic: stringOrNull(row.contact_public),
    verificationStatus: String(row.verification_status ?? "unverified") as VerificationLevel,
    onboardingStatus: stringOrNull(row.onboarding_status),
    verificationEvidence: stringOrNull(row.verification_evidence),
    updatedAt: String(row.updated_at)
  };
}

export async function audit(
  db: D1Database,
  input: {
    actorEmail?: string | null;
    action: string;
    entityType: string;
    entityId: string;
    before?: unknown;
    after?: unknown;
    reason?: string;
    ipHash?: string | null;
  }
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO audit_logs (
        id, actor_email, action, entity_type, entity_id, before_json, after_json, reason, ip_hash, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      makeId("audit"),
      input.actorEmail ?? null,
      input.action,
      input.entityType,
      input.entityId,
      input.before === undefined ? null : JSON.stringify(input.before),
      input.after === undefined ? null : JSON.stringify(input.after),
      input.reason ?? null,
      input.ipHash ?? null,
      nowIso()
    )
    .run();
}

export function json<T>(data: T, init?: ResponseInit): Response {
  return Response.json(data, init);
}

export function badRequest(error: string, status = 400): Response {
  return json({ error }, { status });
}
