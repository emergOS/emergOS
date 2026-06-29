export const reportTypes = ["missing_person", "found_person", "missing_pet", "found_pet"] as const;
export type ReportType = (typeof reportTypes)[number];

export const reportStatuses = [
  "missing",
  "reported_safe",
  "found_needs_help",
  "in_hospital",
  "in_shelter",
  "reunited",
  "needs_foster",
  "deceased_unconfirmed",
  "deceased_verified",
  "duplicate",
  "removed_by_request"
] as const;
export type ReportStatus = (typeof reportStatuses)[number];

export const moderationStatuses = ["published", "pending_review", "rejected", "hidden", "removed"] as const;
export type ModerationStatus = (typeof moderationStatuses)[number];

export const verificationLevels = [
  "unverified",
  "contact_verified",
  "org_verified",
  "official_verified"
] as const;
export type VerificationLevel = (typeof verificationLevels)[number];

export const contactModes = ["public_direct", "protected_form", "organization_mediated"] as const;
export type ContactMode = (typeof contactModes)[number];

export const flyerFormats = ["a4", "a5", "mini4", "poster", "pet"] as const;
export type FlyerFormat = (typeof flyerFormats)[number];

export const partnerApiScopes = [
  "reports:read",
  "pets:read",
  "resources:read",
  "updates:read",
  "organizations:read",
  "map:read"
] as const;
export type PartnerApiScope = (typeof partnerApiScopes)[number];

export const resourceTypes = [
  "shelter",
  "hospital",
  "clinic",
  "pharmacy",
  "food_distribution",
  "water_distribution",
  "aid_collection",
  "charging_station",
  "internet_wifi",
  "legal_aid",
  "psychological_support",
  "transport",
  "animal_shelter",
  "official_resource"
] as const;
export type ResourceType = (typeof resourceTypes)[number];

export const roles = [
  "owner",
  "admin",
  "moderator",
  "verifier",
  "organization_manager",
  "volunteer_coordinator",
  "read_only_observer"
] as const;
export type Role = (typeof roles)[number];

export type PublicConfig = {
  brand: {
    name: string;
    primaryColor: string;
    backgroundColor: string;
  };
  disaster: {
    profile: string;
    country: string;
    defaultLocale: string;
    affectedAreaLabel: string;
  };
  modules: Record<string, boolean>;
  map: {
    tileUrl: string;
    attribution: string;
  };
  moderation: {
    publishMode: "hybrid";
    sensitiveStatusesRequireReview: boolean;
  };
  contactDefaults: {
    mode: ContactMode;
    allowWhatsApp: boolean;
    requireExplicitPublicContactConsent: boolean;
  };
  crisisMode: {
    enabled: boolean;
    disableMaps: boolean;
    preferLists: boolean;
    imageLight: boolean;
  };
  turnstileSiteKey: string;
};

export type PublicReport = {
  id: string;
  type: ReportType;
  displayName: string;
  age: number | null;
  ageRange: string | null;
  description: string | null;
  subjectType?: "person" | "pet";
  pet?: PublicPetDetails | null;
  status: ReportStatus;
  verificationLevel: VerificationLevel;
  publicSlug: string;
  photoUrl: string | null;
  lastSeenAt: string | null;
  lastSeenText: string | null;
  lastSeenAdmin1: string | null;
  lastSeenCity: string | null;
  lastSeenLat?: number | null;
  lastSeenLng?: number | null;
  locationPrecision: string;
  contactMode: ContactMode;
  publicContactType: string | null;
  publicContactValue: string | null;
  notesPublic: string | null;
  moderationStatus: ModerationStatus;
  riskFlags: string[];
  duplicateOfReportId?: string | null;
  assignedOrganizationId?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PublicPetDetails = {
  name: string | null;
  species: string | null;
  breed: string | null;
  color: string | null;
  markings: string | null;
};

export type PublicPetReport = PublicReport & {
  type: "missing_pet" | "found_pet";
  subjectType: "pet";
  pet: PublicPetDetails | null;
};

export type PublicResource = {
  id: string;
  type: ResourceType;
  name: string;
  description: string | null;
  address: string | null;
  admin1: string | null;
  city: string | null;
  hours: string | null;
  capacity: string | null;
  availabilityStatus: string;
  contactPublic: string | null;
  sourceUrl: string | null;
  donationUrl?: string | null;
  donationVerificationStatus?: string | null;
  donationVerifiedAt?: string | null;
  protectedLocation?: boolean;
  acceptedGroups?: string | null;
  accessibility?: string | null;
  supplies?: string | null;
  currentNeeds?: string | null;
  services?: string | null;
  verificationLevel: VerificationLevel;
  lat?: number | null;
  lng?: number | null;
  locationPrecision?: string;
  organizationId?: string | null;
  lastVerifiedAt: string | null;
  verificationDueAt?: string | null;
  updatedAt: string;
};

export type PublicUpdate = {
  id: string;
  title: string;
  body: string;
  type: string;
  source: string | null;
  verificationLevel: VerificationLevel;
  locale: string;
  pinned: boolean;
  publishedAt: string;
};

export type PublicOrganization = {
  id: string;
  name: string;
  type: string;
  description: string | null;
  website: string | null;
  contactPublic: string | null;
  verificationStatus: VerificationLevel;
  onboardingStatus?: string | null;
  verificationEvidence?: string | null;
  updatedAt: string;
};

export type PublicOrganizationDetail = {
  organization: PublicOrganization;
  resources: PublicResource[];
};

export type OrganizationApplication = {
  id: string;
  name: string;
  type: string;
  description: string | null;
  website: string | null;
  contactPublic: string | null;
  verificationEvidence: string | null;
  status: string;
  createdOrganizationId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ReportManagePayload = {
  report: PublicReport;
  statusEvents: Array<Record<string, unknown>>;
  changeRequests?: ReportChangeRequest[];
  generatedAt: string;
};

export type EmergencyContact = {
  id: string;
  label: string;
  contact: string;
  description: string | null;
  sortOrder?: number;
};

export type PublicSearchResponse = {
  reports: PublicReport[];
  pets?: PublicPetReport[];
  resources: PublicResource[];
  updates: PublicUpdate[];
  organizations: PublicOrganization[];
};

export type DashboardMetrics = {
  openMissingCases: number;
  reportedSafeOrFound: number;
  pendingModeration: number;
  newTips24h: number;
  resourcesNeedingUpdate: number;
  mappedResources: number;
  unmappedResources: number;
  mappedReports: number;
  unmappedReports: number;
  hiddenMapRecords: number;
  invalidCoordinateRecords: number;
  publicUpdates: number;
  publicOrganizations: number;
};

export type AdminUser = {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  createdAt: string;
  updatedAt: string;
};

export type AbuseReport = {
  id: string;
  reportId: string | null;
  resourceId: string | null;
  reason: string;
  details: string | null;
  requesterContactPrivate: string | null;
  status: string;
  createdAt: string;
};

export type ContactMessage = {
  id: string;
  reportId: string;
  senderName: string | null;
  senderContactPrivate: string | null;
  body: string;
  status: string;
  createdAt: string;
};

export type DuplicateCandidate = {
  id: string;
  reportId: string;
  candidateReportId: string;
  score: number;
  reasons: string[];
  status: string;
  reportName: string | null;
  candidateName: string | null;
  createdAt: string;
};

export type ImportJob = {
  id: string;
  type: string;
  status: string;
  sourceFilename: string | null;
  totalRows: number;
  processedRows: number;
  errorRows: number;
  errors: string[];
  createdAt: string;
  updatedAt: string;
};

export type ExportJob = {
  id: string;
  type: string;
  status: string;
  rowCount: number;
  downloadUrl: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

export type VolunteerRegistration = {
  id: string;
  name: string;
  location: string | null;
  skills: string | null;
  languages: string | null;
  availability: string | null;
  status: string;
  assignedOrganizationId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type VolunteerAssignment = {
  id: string;
  volunteerId: string;
  organizationId: string | null;
  taskLabel: string;
  status: string;
  notesPrivate: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DataRequest = {
  id: string;
  type: string;
  reportId: string | null;
  details: string | null;
  status: string;
  resultUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

export type RetentionPolicy = {
  id: string;
  name: string;
  tipsDaysAfterClosure: number;
  auditLogDays: number;
  volunteerDaysAfterCrisis: number;
  enabled: boolean;
  updatedAt: string;
};

export type GeneratedFile = {
  id: string;
  type: string;
  label: string | null;
  entityType: string | null;
  entityId: string | null;
  mimeType: string;
  sizeBytes: number | null;
  status: string;
  downloadUrl: string;
  createdAt: string;
};

export type ReportChangeRequest = {
  id: string;
  reportId: string;
  changeType: string;
  oldValue: Record<string, unknown>;
  newValue: Record<string, unknown>;
  reason: string | null;
  status: string;
  reviewerNote: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MediaReviewItem = {
  id: string;
  type: string;
  mimeType: string;
  altText: string | null;
  moderationStatus: string;
  riskFlags: string[];
  reviewedAt: string | null;
  reviewNote: string | null;
  createdAt: string;
};

export type PartnerApiClient = {
  id: string;
  name: string;
  scopes: PartnerApiScope[];
  status: string;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PartnerApiClientCreated = {
  client: PartnerApiClient;
  token: string;
};

export type V1ListResponse<T> = {
  data: T[];
  nextCursor: string | null;
  generatedAt: string;
};

export type OrganizationAssignment = {
  entityType: "report" | "resource" | "contact_message" | "volunteer";
  entityId: string;
  organizationId: string;
};

export type InboundEmailTip = {
  id: string;
  fromEmail: string | null;
  toEmail: string | null;
  subject: string | null;
  relatedReportId: string | null;
  createdTipId: string | null;
  status: string;
  createdAt: string;
};

export type OrganizationMembership = {
  id: string;
  organizationId: string;
  organizationName: string | null;
  userId: string;
  userEmail: string | null;
  role: string;
  createdAt: string;
  updatedAt: string;
};

export type NotificationEvent = {
  id: string;
  channel: string;
  recipient: string;
  templateKey: string;
  status: string;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type WorkflowRun = {
  id: string;
  type: string;
  entityType: string | null;
  entityId: string | null;
  status: string;
  step: string;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

export type GeodataImport = {
  id: string;
  type: string;
  status: string;
  sourceFilename: string | null;
  totalFeatures: number;
  processedFeatures: number;
  errorFeatures: number;
  errors: string[];
  createdAt: string;
  updatedAt: string;
};

export type AiSuggestion = {
  id: string;
  type: string;
  entityType: string | null;
  entityId: string | null;
  suggestion: Record<string, unknown>;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export type HealthMetrics = {
  pendingNotifications: number;
  failedNotifications: number;
  activeWorkflows: number;
  failedWorkflows: number;
  failedImports: number;
  openModeration: number;
  openAbuseReports: number;
  oldResources: number;
  generatedFiles: number;
};

export type MapFeature = {
  id: string;
  type: "resource" | "report" | "layer";
  label: string;
  category: string;
  status: string;
  locationLabel: string | null;
  lat?: number | null;
  lng?: number | null;
  geometry?: Record<string, unknown> | null;
  precision: string;
  url: string;
  verificationLevel: VerificationLevel;
  updatedAt: string;
};

export type MapLayer = {
  id: string;
  type: string;
  label: string;
  description: string | null;
  geometry: Record<string, unknown>;
  status: string;
  visibility: string;
  verificationLevel: VerificationLevel;
  organizationId: string | null;
  sourceUrl: string | null;
  updatedAt: string;
};

export type LocaleOverride = {
  id: string;
  locale: string;
  namespace: string;
  key: string;
  value: string;
  updatedAt: string;
};

export type ResourceTranslation = {
  id: string;
  resourceId: string;
  locale: string;
  name: string | null;
  description: string | null;
  services: string | null;
  currentNeeds: string | null;
  updatedAt: string;
};

export const statusLabels: Record<ReportStatus, string> = {
  missing: "Missing",
  reported_safe: "Reported safe",
  found_needs_help: "Found, needs assistance",
  in_hospital: "In hospital",
  in_shelter: "In shelter",
  reunited: "Reunited",
  needs_foster: "Needs foster",
  deceased_unconfirmed: "Reported deceased, unconfirmed",
  deceased_verified: "Deceased, verified",
  duplicate: "Duplicate",
  removed_by_request: "Removed by request"
};

export const verificationLabels: Record<VerificationLevel, string> = {
  unverified: "Community report",
  contact_verified: "Contact verified",
  org_verified: "Organization verified",
  official_verified: "Officially verified"
};

export const resourceTypeLabels: Record<ResourceType, string> = {
  shelter: "Shelter",
  hospital: "Hospital",
  clinic: "Clinic",
  pharmacy: "Pharmacy",
  food_distribution: "Food distribution",
  water_distribution: "Water distribution",
  aid_collection: "Aid collection",
  charging_station: "Charging station",
  internet_wifi: "Internet / Wi-Fi",
  legal_aid: "Legal aid",
  psychological_support: "Psychological support",
  transport: "Transport",
  animal_shelter: "Animal shelter",
  official_resource: "Official resource"
};
