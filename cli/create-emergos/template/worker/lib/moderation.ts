import type { ContactMode, ReportStatus } from "../../src/lib/contracts";

export type ReportRiskInput = {
  age?: number | null;
  ageRange?: string | null;
  status: ReportStatus;
  contactMode: ContactMode;
  publicContactConsent: boolean;
  text: string;
  profile: string;
};

const deathPattern = /\b(dead|deceased|died|body|corpse|falleci|muert|cad[aá]ver)\b/i;
const childPattern = /\b(child|minor|kid|baby|niñ|menor|beb[eé])\b/i;
const donationPattern = /\b(donate|donation|bank account|crypto|paypal|zelle|binance|donaci[oó]n)\b/i;
const sensitivePlacePattern = /\b(hospital|shelter|refuge|clinic|refugio|hospital|cl[ií]nica)\b/i;

export function assessReportRisk(input: ReportRiskInput): string[] {
  const flags = new Set<string>();

  if (input.status === "deceased_unconfirmed" || input.status === "deceased_verified" || deathPattern.test(input.text)) {
    flags.add("death_related");
  }
  if ((typeof input.age === "number" && input.age < 18) || childPattern.test(input.ageRange ?? "") || childPattern.test(input.text)) {
    flags.add("child_or_minor");
  }
  if (input.profile === "conflict" || input.profile === "displacement") {
    flags.add("conflict_context");
  }
  if (input.contactMode === "public_direct" && !input.publicContactConsent) {
    flags.add("missing_public_contact_consent");
  }
  if (donationPattern.test(input.text)) {
    flags.add("donation_or_scam_risk");
  }
  if (sensitivePlacePattern.test(input.text) && input.profile === "conflict") {
    flags.add("sensitive_location_context");
  }

  return Array.from(flags);
}

export function moderationStatusForFlags(flags: string[]): "published" | "pending_review" {
  return flags.length ? "pending_review" : "published";
}
