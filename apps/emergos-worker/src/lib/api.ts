import type {
  AdminUser,
  AiSuggestion,
  DataRequest,
  DashboardMetrics,
  DuplicateCandidate,
  EmergencyContact,
  ExportJob,
  GeneratedFile,
  GeodataImport,
  HealthMetrics,
  InboundEmailTip,
  ImportJob,
  LocaleOverride,
  MapFeature,
  MapLayer,
  MediaReviewItem,
  NotificationEvent,
  OrganizationApplication,
  OrganizationMembership,
  PartnerApiClient,
  PartnerApiClientCreated,
  PublicConfig,
  PublicOrganization,
  PublicOrganizationDetail,
  PublicPetReport,
  PublicReport,
  PublicResource,
  PublicSearchResponse,
  PublicUpdate,
  ReportManagePayload,
  RetentionPolicy,
  ResourceTranslation,
  VolunteerAssignment,
  VolunteerRegistration,
  WorkflowRun
} from "./contracts";

type ApiResult<T> = { data: T; error?: never } | { data?: never; error: string };

async function request<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...(init?.headers ?? {})
    }
  });

  if (!response.ok) {
    let message = `Request failed with ${response.status}`;
    try {
      const body = (await response.json()) as { error?: string };
      message = body.error ?? message;
    } catch {
      // Keep generic message.
    }
    return { error: message };
  }

  return { data: (await response.json()) as T };
}

export const api = {
  config: () => request<PublicConfig>("/api/public/config"),
  search: (query = "") => request<PublicSearchResponse>(`/api/public/search${query}`),
  semanticSearch: (query = "") => request<PublicSearchResponse>(`/api/public/search/semantic${query}`),
  offlineManifest: () => request<{ version: string; urls: string[]; generatedAt: string }>("/api/public/offline-manifest"),
  reports: (query = "") => request<{ reports: PublicReport[] }>(`/api/public/reports${query}`),
  report: (slug: string) => request<{ report: PublicReport; tips: unknown[] }>(`/api/public/reports/${slug}`),
  resources: () => request<{ resources: PublicResource[] }>("/api/public/resources"),
  resource: (id: string) => request<{ resource: PublicResource }>(`/api/public/resources/${id}`),
  contacts: () => request<{ contacts: EmergencyContact[] }>("/api/public/emergency-contacts"),
  updates: () => request<{ updates: PublicUpdate[] }>("/api/public/updates"),
  update: (id: string) => request<{ update: PublicUpdate }>(`/api/public/updates/${id}`),
  organizations: () => request<{ organizations: PublicOrganization[] }>("/api/public/organizations"),
  organization: (id: string) => request<PublicOrganizationDetail>(`/api/public/organizations/${id}`),
  mapFeatures: () => request<{ features: MapFeature[] }>("/api/public/map-features"),
  pets: (query = "") => request<{ pets: PublicPetReport[] }>(`/api/public/pets${query}`),
  pet: (slug: string) => request<{ pet: PublicPetReport }>(`/api/public/pets/${slug}`),
  localePack: (locale: string) => request<{ locale: string; overrides: Record<string, string>; generatedAt: string }>(`/api/public/locales/${encodeURIComponent(locale)}`),
  createReport: (body: FormData) => request<{ report: PublicReport; moderationStatus: string; manageToken: string; manageUrl: string }>("/api/public/reports", { method: "POST", body }),
  reportManage: (slug: string, token: string) => request<ReportManagePayload>(`/api/public/reports/${slug}/manage?token=${encodeURIComponent(token)}`),
  updateReportManage: (slug: string, token: string, body: FormData) => request<{ report: PublicReport | null; moderationStatus: string }>(`/api/public/reports/${slug}/manage?token=${encodeURIComponent(token)}`, { method: "PATCH", body }),
  registerVolunteer: (body: FormData) => request<{ volunteerId: string; moderationStatus: string }>("/api/public/volunteers", { method: "POST", body }),
  submitDataRequest: (body: FormData) => request<{ dataRequestId: string; status: string }>("/api/public/data-requests", { method: "POST", body }),
  applyOrganization: (body: FormData) => request<{ applicationId: string; status: string }>("/api/public/organizations/apply", { method: "POST", body }),
  submitTip: (slug: string, body: FormData) => request<{ tipId: string; moderationStatus: string }>(`/api/public/reports/${slug}/tips`, { method: "POST", body }),
  submitGeneralTip: (body: FormData) => request<{ tipId: string; moderationStatus: string }>("/api/public/tips", { method: "POST", body }),
  submitContactMessage: (slug: string, body: FormData) =>
    request<{ messageId: string; moderationStatus: string }>(`/api/public/reports/${slug}/contact`, { method: "POST", body }),
  submitAbuseReport: (body: FormData) =>
    request<{ abuseReportId: string; moderationStatus: string }>("/api/public/abuse-reports", { method: "POST", body }),
  dashboard: (adminEmail: string) =>
    request<{ metrics: DashboardMetrics }>("/api/admin/dashboard", {
      headers: adminEmail ? { "x-emergos-admin-email": adminEmail } : undefined
    }),
  adminReports: (adminEmail: string) =>
    request<{ reports: PublicReport[] }>("/api/admin/reports", {
      headers: adminEmail ? { "x-emergos-admin-email": adminEmail } : undefined
    }),
  adminTips: (adminEmail: string) =>
    request<{ tips: Array<Record<string, unknown>> }>("/api/admin/tips", {
      headers: adminEmail ? { "x-emergos-admin-email": adminEmail } : undefined
    }),
  updateReport: (adminEmail: string, reportId: string, body: Record<string, unknown>) =>
    request<{ ok: true }>(`/api/admin/reports/${reportId}`, {
      method: "PATCH",
      headers: adminEmail ? { "x-emergos-admin-email": adminEmail } : undefined,
      body: JSON.stringify(body)
    }),
  moderation: (adminEmail: string) =>
    request<{ items: unknown[] }>("/api/admin/moderation", {
      headers: adminEmail ? { "x-emergos-admin-email": adminEmail } : undefined
    }),
  workQueue: (adminEmail: string, query = "") =>
    request<{ items: unknown[] }>(`/api/admin/work-queue${query}`, {
      headers: adminEmail ? { "x-emergos-admin-email": adminEmail } : undefined
    }),
  approveModeration: (adminEmail: string, itemId: string) =>
    request<{ ok: true }>(`/api/admin/moderation/${itemId}/approve`, {
      method: "POST",
      headers: adminEmail ? { "x-emergos-admin-email": adminEmail } : undefined
    }),
  rejectModeration: (adminEmail: string, itemId: string) =>
    request<{ ok: true }>(`/api/admin/moderation/${itemId}/reject`, {
      method: "POST",
      headers: adminEmail ? { "x-emergos-admin-email": adminEmail } : undefined
    }),
  moderationAction: (adminEmail: string, itemId: string, body: Record<string, unknown>) =>
    request<{ ok: true }>(`/api/admin/moderation/${itemId}/action`, {
      method: "POST",
      headers: adminEmail ? { "x-emergos-admin-email": adminEmail } : undefined,
      body: JSON.stringify(body)
    }),
  adminResources: (adminEmail: string) =>
    request<{ resources: PublicResource[] }>("/api/admin/resources", {
      headers: adminEmail ? { "x-emergos-admin-email": adminEmail } : undefined
    }),
  createResource: (adminEmail: string, body: Record<string, unknown>) =>
    request<{ id: string }>("/api/admin/resources", {
      method: "POST",
      headers: adminEmail ? { "x-emergos-admin-email": adminEmail } : undefined,
      body: JSON.stringify(body)
    }),
  assignReportOrganization: (adminEmail: string, reportId: string, organizationId: string) =>
    request<{ ok: true }>(`/api/admin/reports/${reportId}/assign-organization`, {
      method: "POST",
      headers: adminEmail ? { "x-emergos-admin-email": adminEmail } : undefined,
      body: JSON.stringify({ organizationId })
    }),
  assignResourceOrganization: (adminEmail: string, resourceId: string, organizationId: string) =>
    request<{ ok: true }>(`/api/admin/resources/${resourceId}/assign-organization`, {
      method: "POST",
      headers: adminEmail ? { "x-emergos-admin-email": adminEmail } : undefined,
      body: JSON.stringify({ organizationId })
    }),
  organizationDashboard: (adminEmail: string) =>
    request<{ organizations: PublicOrganization[]; reports: PublicReport[]; resources: PublicResource[]; volunteers: VolunteerRegistration[] }>("/api/admin/organization-dashboard", {
      headers: adminEmail ? { "x-emergos-admin-email": adminEmail } : undefined
    }),
  orgDashboard: (adminEmail: string) =>
    request<{ organizations: PublicOrganization[]; reports: PublicReport[]; resources: PublicResource[]; volunteers: VolunteerRegistration[] }>("/api/org/dashboard", {
      headers: adminEmail ? { "x-emergos-admin-email": adminEmail } : undefined
    }),
  updateOrgProfile: (adminEmail: string, organizationId: string, body: Record<string, unknown>) =>
    request<{ ok: true }>(`/api/org/profile/${organizationId}`, {
      method: "PATCH",
      headers: adminEmail ? { "x-emergos-admin-email": adminEmail } : undefined,
      body: JSON.stringify(body)
    }),
  organizationMemberships: (adminEmail: string) =>
    request<{ memberships: OrganizationMembership[] }>("/api/admin/organization-memberships", {
      headers: adminEmail ? { "x-emergos-admin-email": adminEmail } : undefined
    }),
  createOrganizationMembership: (adminEmail: string, body: Record<string, unknown>) =>
    request<{ id: string }>("/api/admin/organization-memberships", {
      method: "POST",
      headers: adminEmail ? { "x-emergos-admin-email": adminEmail } : undefined,
      body: JSON.stringify(body)
    }),
  deleteOrganizationMembership: (adminEmail: string, membershipId: string) =>
    request<{ ok: true }>(`/api/admin/organization-memberships/${membershipId}`, {
      method: "DELETE",
      headers: adminEmail ? { "x-emergos-admin-email": adminEmail } : undefined
    }),
  updateResource: (adminEmail: string, resourceId: string, body: Record<string, unknown>) =>
    request<{ ok: true }>(`/api/admin/resources/${resourceId}`, {
      method: "PATCH",
      headers: adminEmail ? { "x-emergos-admin-email": adminEmail } : undefined,
      body: JSON.stringify(body)
    }),
  markResourceVerified: (adminEmail: string, resourceId: string, verificationLevel: string) =>
    request<{ ok: true }>(`/api/admin/resources/${resourceId}`, {
      method: "PATCH",
      headers: adminEmail ? { "x-emergos-admin-email": adminEmail } : undefined,
      body: JSON.stringify({ verificationLevel })
    }),
  adminContacts: (adminEmail: string) =>
    request<{ contacts: EmergencyContact[] }>("/api/admin/emergency-contacts", {
      headers: adminEmail ? { "x-emergos-admin-email": adminEmail } : undefined
    }),
  createContact: (adminEmail: string, body: Record<string, unknown>) =>
    request<{ id: string }>("/api/admin/emergency-contacts", {
      method: "POST",
      headers: adminEmail ? { "x-emergos-admin-email": adminEmail } : undefined,
      body: JSON.stringify(body)
    }),
  updateContact: (adminEmail: string, contactId: string, body: Record<string, unknown>) =>
    request<{ ok: true }>(`/api/admin/emergency-contacts/${contactId}`, {
      method: "PATCH",
      headers: adminEmail ? { "x-emergos-admin-email": adminEmail } : undefined,
      body: JSON.stringify(body)
    }),
  adminUsers: (adminEmail: string) =>
    request<{ users: AdminUser[] }>("/api/admin/users", {
      headers: adminEmail ? { "x-emergos-admin-email": adminEmail } : undefined
    }),
  createUser: (adminEmail: string, body: Record<string, unknown>) =>
    request<{ id: string }>("/api/admin/users", {
      method: "POST",
      headers: adminEmail ? { "x-emergos-admin-email": adminEmail } : undefined,
      body: JSON.stringify(body)
    }),
  updateUserRole: (adminEmail: string, userId: string, role: string) =>
    request<{ ok: true }>(`/api/admin/users/${userId}/roles`, {
      method: "PATCH",
      headers: adminEmail ? { "x-emergos-admin-email": adminEmail } : undefined,
      body: JSON.stringify({ role })
    }),
  apiClients: (adminEmail: string) =>
    request<{ clients: PartnerApiClient[] }>("/api/admin/api-clients", {
      headers: adminEmail ? { "x-emergos-admin-email": adminEmail } : undefined
    }),
  createApiClient: (adminEmail: string, body: Record<string, unknown>) =>
    request<PartnerApiClientCreated>("/api/admin/api-clients", {
      method: "POST",
      headers: adminEmail ? { "x-emergos-admin-email": adminEmail } : undefined,
      body: JSON.stringify(body)
    }),
  revokeApiClient: (adminEmail: string, clientId: string) =>
    request<{ ok: true }>(`/api/admin/api-clients/${clientId}/revoke`, {
      method: "POST",
      headers: adminEmail ? { "x-emergos-admin-email": adminEmail } : undefined
    }),
  duplicates: (adminEmail: string) =>
    request<{ duplicates: DuplicateCandidate[] }>("/api/admin/duplicates", {
      headers: adminEmail ? { "x-emergos-admin-email": adminEmail } : undefined
    }),
  requestDuplicateCheck: (adminEmail: string, reportId: string) =>
    request<{ ok: true }>(`/api/admin/reports/${reportId}/duplicate-check`, {
      method: "POST",
      headers: adminEmail ? { "x-emergos-admin-email": adminEmail } : undefined
    }),
  mergeReport: (adminEmail: string, reportId: string, canonicalReportId: string) =>
    request<{ ok: true; canonicalSlug: string }>(`/api/admin/reports/${reportId}/merge`, {
      method: "POST",
      headers: adminEmail ? { "x-emergos-admin-email": adminEmail } : undefined,
      body: JSON.stringify({ canonicalReportId })
    }),
  imports: (adminEmail: string) =>
    request<{ imports: ImportJob[] }>("/api/admin/imports", {
      headers: adminEmail ? { "x-emergos-admin-email": adminEmail } : undefined
    }),
  createImport: (adminEmail: string, body: FormData) =>
    request<{ id: string }>("/api/admin/imports", {
      method: "POST",
      headers: adminEmail ? { "x-emergos-admin-email": adminEmail } : undefined,
      body
    }),
  exports: (adminEmail: string) =>
    request<{ exports: ExportJob[] }>("/api/admin/exports", {
      headers: adminEmail ? { "x-emergos-admin-email": adminEmail } : undefined
    }),
  createExport: (adminEmail: string, body: Record<string, unknown>) =>
    request<{ id: string }>("/api/admin/exports", {
      method: "POST",
      headers: adminEmail ? { "x-emergos-admin-email": adminEmail } : undefined,
      body: JSON.stringify(body)
    }),
  adminOrganizations: (adminEmail: string) =>
    request<{ organizations: PublicOrganization[] }>("/api/admin/organizations", {
      headers: adminEmail ? { "x-emergos-admin-email": adminEmail } : undefined
    }),
  organizationApplications: (adminEmail: string) =>
    request<{ applications: OrganizationApplication[] }>("/api/admin/organization-applications", {
      headers: adminEmail ? { "x-emergos-admin-email": adminEmail } : undefined
    }),
  approveOrganizationApplication: (adminEmail: string, applicationId: string) =>
    request<{ ok: true; organizationId: string }>(`/api/admin/organization-applications/${applicationId}/approve`, {
      method: "POST",
      headers: adminEmail ? { "x-emergos-admin-email": adminEmail } : undefined
    }),
  rejectOrganizationApplication: (adminEmail: string, applicationId: string, reason?: string) =>
    request<{ ok: true }>(`/api/admin/organization-applications/${applicationId}/reject`, {
      method: "POST",
      headers: adminEmail ? { "x-emergos-admin-email": adminEmail } : undefined,
      body: JSON.stringify({ reason })
    }),
  createOrganization: (adminEmail: string, body: Record<string, unknown>) =>
    request<{ id: string }>("/api/admin/organizations", {
      method: "POST",
      headers: adminEmail ? { "x-emergos-admin-email": adminEmail } : undefined,
      body: JSON.stringify(body)
    }),
  updateOrganization: (adminEmail: string, organizationId: string, body: Record<string, unknown>) =>
    request<{ ok: true }>(`/api/admin/organizations/${organizationId}`, {
      method: "PATCH",
      headers: adminEmail ? { "x-emergos-admin-email": adminEmail } : undefined,
      body: JSON.stringify(body)
    }),
  adminVolunteers: (adminEmail: string) =>
    request<{ volunteers: VolunteerRegistration[] }>("/api/admin/volunteers", {
      headers: adminEmail ? { "x-emergos-admin-email": adminEmail } : undefined
    }),
  volunteerAssignments: (adminEmail: string) =>
    request<{ assignments: VolunteerAssignment[] }>("/api/admin/volunteer-assignments", {
      headers: adminEmail ? { "x-emergos-admin-email": adminEmail } : undefined
    }),
  createVolunteerAssignment: (adminEmail: string, body: Record<string, unknown>) =>
    request<{ id: string }>("/api/admin/volunteer-assignments", {
      method: "POST",
      headers: adminEmail ? { "x-emergos-admin-email": adminEmail } : undefined,
      body: JSON.stringify(body)
    }),
  updateVolunteerAssignment: (adminEmail: string, assignmentId: string, body: Record<string, unknown>) =>
    request<{ ok: true }>(`/api/admin/volunteer-assignments/${assignmentId}`, {
      method: "PATCH",
      headers: adminEmail ? { "x-emergos-admin-email": adminEmail } : undefined,
      body: JSON.stringify(body)
    }),
  updateVolunteer: (adminEmail: string, volunteerId: string, body: Record<string, unknown>) =>
    request<{ ok: true }>(`/api/admin/volunteers/${volunteerId}`, {
      method: "PATCH",
      headers: adminEmail ? { "x-emergos-admin-email": adminEmail } : undefined,
      body: JSON.stringify(body)
    }),
  createUpdate: (adminEmail: string, body: Record<string, unknown>) =>
    request<{ id: string }>("/api/admin/updates", {
      method: "POST",
      headers: adminEmail ? { "x-emergos-admin-email": adminEmail } : undefined,
      body: JSON.stringify(body)
    }),
  updateUpdate: (adminEmail: string, updateId: string, body: Record<string, unknown>) =>
    request<{ ok: true }>(`/api/admin/updates/${updateId}`, {
      method: "PATCH",
      headers: adminEmail ? { "x-emergos-admin-email": adminEmail } : undefined,
      body: JSON.stringify(body)
    }),
  dataRequests: (adminEmail: string) =>
    request<{ dataRequests: DataRequest[] }>("/api/admin/data-requests", {
      headers: adminEmail ? { "x-emergos-admin-email": adminEmail } : undefined
    }),
  updateDataRequest: (adminEmail: string, requestId: string, body: Record<string, unknown>) =>
    request<{ ok: true }>(`/api/admin/data-requests/${requestId}`, {
      method: "PATCH",
      headers: adminEmail ? { "x-emergos-admin-email": adminEmail } : undefined,
      body: JSON.stringify(body)
    }),
  generateDataRequestExport: (adminEmail: string, requestId: string) =>
    request<{ ok: true; fileId: string }>(`/api/admin/data-requests/${requestId}/generate-export`, {
      method: "POST",
      headers: adminEmail ? { "x-emergos-admin-email": adminEmail } : undefined
    }),
  generatedFiles: (adminEmail: string) =>
    request<{ files: GeneratedFile[] }>("/api/admin/generated-files", {
      headers: adminEmail ? { "x-emergos-admin-email": adminEmail } : undefined
    }),
  mediaReview: (adminEmail: string) =>
    request<{ media: MediaReviewItem[] }>("/api/admin/media-review", {
      headers: adminEmail ? { "x-emergos-admin-email": adminEmail } : undefined
    }),
  createGeneratedFile: (adminEmail: string, body: Record<string, unknown>) =>
    request<{ id: string }>("/api/admin/generated-files", {
      method: "POST",
      headers: adminEmail ? { "x-emergos-admin-email": adminEmail } : undefined,
      body: JSON.stringify(body)
    }),
  inboundEmails: (adminEmail: string) =>
    request<{ emails: InboundEmailTip[] }>("/api/admin/inbound-emails", {
      headers: adminEmail ? { "x-emergos-admin-email": adminEmail } : undefined
    }),
  notifications: (adminEmail: string) =>
    request<{ notifications: NotificationEvent[] }>("/api/admin/notifications", {
      headers: adminEmail ? { "x-emergos-admin-email": adminEmail } : undefined
    }),
  createNotification: (adminEmail: string, body: Record<string, unknown>) =>
    request<{ id: string }>("/api/admin/notifications/test", {
      method: "POST",
      headers: adminEmail ? { "x-emergos-admin-email": adminEmail } : undefined,
      body: JSON.stringify(body)
    }),
  processNotification: (adminEmail: string, notificationId: string) =>
    request<{ ok: true }>(`/api/admin/notifications/${notificationId}/process`, {
      method: "POST",
      headers: adminEmail ? { "x-emergos-admin-email": adminEmail } : undefined
    }),
  cancelNotification: (adminEmail: string, notificationId: string) =>
    request<{ ok: true }>(`/api/admin/notifications/${notificationId}/cancel`, {
      method: "POST",
      headers: adminEmail ? { "x-emergos-admin-email": adminEmail } : undefined
    }),
  workflows: (adminEmail: string) =>
    request<{ workflows: WorkflowRun[] }>("/api/admin/workflows", {
      headers: adminEmail ? { "x-emergos-admin-email": adminEmail } : undefined
    }),
  createWorkflow: (adminEmail: string, body: Record<string, unknown>) =>
    request<{ id: string }>("/api/admin/workflows", {
      method: "POST",
      headers: adminEmail ? { "x-emergos-admin-email": adminEmail } : undefined,
      body: JSON.stringify(body)
    }),
  geodataImports: (adminEmail: string) =>
    request<{ imports: GeodataImport[] }>("/api/admin/geodata/imports", {
      headers: adminEmail ? { "x-emergos-admin-email": adminEmail } : undefined
    }),
  createGeodataImport: (adminEmail: string, body: FormData) =>
    request<{ id: string }>("/api/admin/geodata/imports", {
      method: "POST",
      headers: adminEmail ? { "x-emergos-admin-email": adminEmail } : undefined,
      body
    }),
  mapLayers: (adminEmail: string) =>
    request<{ layers: MapLayer[] }>("/api/admin/map-layers", {
      headers: adminEmail ? { "x-emergos-admin-email": adminEmail } : undefined
    }),
  createMapLayer: (adminEmail: string, body: Record<string, unknown>) =>
    request<{ id: string }>("/api/admin/map-layers", {
      method: "POST",
      headers: adminEmail ? { "x-emergos-admin-email": adminEmail } : undefined,
      body: JSON.stringify(body)
    }),
  updateMapLayer: (adminEmail: string, layerId: string, body: Record<string, unknown>) =>
    request<{ ok: true }>(`/api/admin/map-layers/${layerId}`, {
      method: "PATCH",
      headers: adminEmail ? { "x-emergos-admin-email": adminEmail } : undefined,
      body: JSON.stringify(body)
    }),
  resourceTranslations: (adminEmail: string) =>
    request<{ translations: ResourceTranslation[] }>("/api/admin/resource-translations", {
      headers: adminEmail ? { "x-emergos-admin-email": adminEmail } : undefined
    }),
  saveResourceTranslation: (adminEmail: string, body: Record<string, unknown>) =>
    request<{ id: string }>("/api/admin/resource-translations", {
      method: "POST",
      headers: adminEmail ? { "x-emergos-admin-email": adminEmail } : undefined,
      body: JSON.stringify(body)
    }),
  localeOverrides: (adminEmail: string) =>
    request<{ overrides: LocaleOverride[] }>("/api/admin/locale-overrides", {
      headers: adminEmail ? { "x-emergos-admin-email": adminEmail } : undefined
    }),
  saveLocaleOverride: (adminEmail: string, body: Record<string, unknown>) =>
    request<{ id: string }>("/api/admin/locale-overrides", {
      method: "POST",
      headers: adminEmail ? { "x-emergos-admin-email": adminEmail } : undefined,
      body: JSON.stringify(body)
    }),
  aiSuggestions: (adminEmail: string) =>
    request<{ suggestions: AiSuggestion[] }>("/api/admin/ai/suggestions", {
      headers: adminEmail ? { "x-emergos-admin-email": adminEmail } : undefined
    }),
  createAiSuggestion: (adminEmail: string, body: Record<string, unknown>) =>
    request<{ id: string; suggestion: Record<string, unknown> }>("/api/admin/ai/moderation-suggestion", {
      method: "POST",
      headers: adminEmail ? { "x-emergos-admin-email": adminEmail } : undefined,
      body: JSON.stringify(body)
    }),
  createTranslationDraft: (adminEmail: string, body: Record<string, unknown>) =>
    request<{ id: string; suggestion: Record<string, unknown> }>("/api/admin/ai/translation-draft", {
      method: "POST",
      headers: adminEmail ? { "x-emergos-admin-email": adminEmail } : undefined,
      body: JSON.stringify(body)
    }),
  health: (adminEmail: string) =>
    request<{ metrics: HealthMetrics }>("/api/admin/health", {
      headers: adminEmail ? { "x-emergos-admin-email": adminEmail } : undefined
    }),
  retentionPolicy: (adminEmail: string) =>
    request<{ policy: RetentionPolicy }>("/api/admin/retention-policy", {
      headers: adminEmail ? { "x-emergos-admin-email": adminEmail } : undefined
    }),
  updateRetentionPolicy: (adminEmail: string, body: Record<string, unknown>) =>
    request<{ ok: true }>("/api/admin/retention-policy", {
      method: "PATCH",
      headers: adminEmail ? { "x-emergos-admin-email": adminEmail } : undefined,
      body: JSON.stringify(body)
    }),
  updateCrisisMode: (adminEmail: string, body: Record<string, unknown>) =>
    request<{ ok: true }>("/api/admin/settings/crisis-mode", {
      method: "PATCH",
      headers: adminEmail ? { "x-emergos-admin-email": adminEmail } : undefined,
      body: JSON.stringify(body)
    }),
  updateModules: (adminEmail: string, body: Record<string, boolean>) =>
    request<{ ok: true }>("/api/admin/settings/modules", {
      method: "PATCH",
      headers: adminEmail ? { "x-emergos-admin-email": adminEmail } : undefined,
      body: JSON.stringify(body)
    }),
  retentionPreview: (adminEmail: string) =>
    request<{ preview: Record<string, number> }>("/api/admin/retention/preview", {
      method: "POST",
      headers: adminEmail ? { "x-emergos-admin-email": adminEmail } : undefined
    }),
  runRetention: (adminEmail: string) =>
    request<{ preview: Record<string, number> }>("/api/admin/retention/run", {
      method: "POST",
      headers: adminEmail ? { "x-emergos-admin-email": adminEmail } : undefined
    }),
  auditLogs: (adminEmail: string) =>
    request<{ logs: Array<Record<string, unknown>> }>("/api/admin/audit-logs", {
      headers: adminEmail ? { "x-emergos-admin-email": adminEmail } : undefined
    })
};
