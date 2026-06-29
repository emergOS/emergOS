import {
  AlertTriangle,
  BadgeCheck,
  Bell,
  Brain,
  Building2,
  ClipboardList,
  FileText,
  HeartHandshake,
  Hospital,
  ImageIcon,
  KeyRound,
  MapPin,
  Menu,
  PawPrint,
  Printer,
  Search,
  ShieldCheck,
  UserPlus,
  X
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./lib/api";
import {
  AdminUser,
  AiSuggestion,
  DataRequest,
  DuplicateCandidate,
  contactModes,
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
  PublicConfig,
  PublicOrganization,
  PublicOrganizationDetail,
  PublicPetReport,
  PublicReport,
  PublicResource,
  PublicUpdate,
  RetentionPolicy,
  ResourceTranslation,
  VolunteerAssignment,
  VolunteerRegistration,
  WorkflowRun,
  reportStatuses,
  reportTypes,
  resourceTypes,
  resourceTypeLabels,
  roles,
  statusLabels,
  verificationLabels
} from "./lib/contracts";
import { t } from "./lib/i18n";

type View = "home" | "search" | "reports" | "report" | "report-manage" | "new-report" | "pets" | "pet" | "new-tip" | "resources" | "resource" | "map" | "updates" | "update" | "organizations" | "organization" | "organization-apply" | "org-portal" | "volunteer" | "data-request" | "admin";
type RouteState = { view: View; slug?: string; resourceId?: string; updateId?: string; organizationId?: string; reportType?: string; adminTab?: string; search: string };

const moduleKeys = [
  "missingPeople",
  "foundPeople",
  "tips",
  "flyers",
  "shelters",
  "hospitals",
  "aidCenters",
  "missingPets",
  "volunteers",
  "emergencyContacts",
  "maps",
  "organizations",
  "publicUpdates",
  "privacyRequests"
] as const;

const moduleLabels: Record<(typeof moduleKeys)[number], string> = {
  missingPeople: "Missing people",
  foundPeople: "Found people",
  tips: "Tips",
  flyers: "Flyers",
  shelters: "Shelters",
  hospitals: "Hospitals",
  aidCenters: "Aid centers",
  missingPets: "Missing pets",
  volunteers: "Volunteers",
  emergencyContacts: "Emergency contacts",
  maps: "Map",
  organizations: "Organizations",
  publicUpdates: "Public updates",
  privacyRequests: "Privacy requests"
};

const adminNavigation = [
  { group: "Command", items: ["overview", "health", "modules"] },
  { group: "Triage", items: ["queue", "moderation", "media", "tips", "privacy", "duplicates"] },
  { group: "People", items: ["reports", "volunteers"] },
  { group: "Resources", items: ["resources", "mapLayers", "geodata", "translations", "imports"] },
  { group: "Partners", items: ["organizations", "organizationApplications", "memberships", "apiClients"] },
  { group: "Comms", items: ["updates", "email", "notifications", "files"] },
  { group: "System", items: ["workflows", "ai", "contacts", "users", "retention", "audit"] }
] as const;

const adminTabLabels: Record<string, string> = {
  overview: "Command center",
  health: "Health",
  modules: "Modules",
  queue: "Work queue",
  moderation: "Moderation",
  media: "Media review",
  reports: "Reports",
  duplicates: "Duplicates",
  resources: "Resources",
  mapLayers: "Map layers",
  translations: "Translations",
  updates: "Updates",
  organizations: "Organizations",
  organizationApplications: "Org applications",
  memberships: "Memberships",
  apiClients: "Partner API",
  volunteers: "Volunteers",
  imports: "Imports/exports",
  geodata: "Geodata",
  files: "Files",
  email: "Email",
  notifications: "Notifications",
  workflows: "Workflows",
  ai: "AI",
  contacts: "Contacts",
  users: "Users",
  privacy: "Privacy",
  retention: "Retention",
  tips: "Tips",
  audit: "Audit"
};

const adminTabIds: string[] = adminNavigation.flatMap((group) => [...group.items]);

function adminTabPath(tab: string): string {
  if (tab === "overview") return "/admin";
  return `/admin/${tab.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase()}`;
}

function adminPathTab(path: string): string {
  const slug = path.split("/").filter(Boolean)[1] ?? "overview";
  const tab = slug.replace(/-([a-z])/g, (_, value: string) => value.toUpperCase());
  return adminTabIds.includes(tab) ? tab : "overview";
}

type LeafletMapInstance = {
  setView(center: [number, number], zoom: number): LeafletMapInstance;
  fitBounds(bounds: LeafletBounds, options?: { padding?: [number, number]; maxZoom?: number }): LeafletMapInstance;
  on?(event: string, handler: (event: LeafletClickEvent) => void): LeafletMapInstance;
  remove(): void;
};

type LeafletClickEvent = {
  latlng: {
    lat: number;
    lng: number;
  };
};

type LeafletBounds = {
  isValid(): boolean;
};

type LeafletLayer = {
  addTo(map: LeafletMapInstance): LeafletLayer;
  bindPopup?(content: string): LeafletLayer;
  on?(event: string, handler: () => void): LeafletLayer;
  remove?(): void;
  setLatLng?(point: [number, number]): LeafletLayer;
};

type LeafletNamespace = {
  map(element: HTMLElement, options?: Record<string, unknown>): LeafletMapInstance;
  tileLayer(url: string, options?: Record<string, unknown>): LeafletLayer;
  marker(point: [number, number], options?: Record<string, unknown>): LeafletLayer;
  latLngBounds(points: Array<[number, number]>): LeafletBounds;
};

let leafletPromise: Promise<LeafletNamespace> | null = null;

function parsePath(): RouteState {
  const path = window.location.pathname;
  if (path.startsWith("/pets/new")) {
    return { view: "new-report", reportType: new URLSearchParams(window.location.search).get("type") ?? "missing_pet", search: window.location.search };
  }
  if (path.startsWith("/pets/")) return { view: "pet", slug: path.split("/")[2], search: window.location.search };
  if (path.startsWith("/pets")) return { view: "pets", search: window.location.search };
  if (path.startsWith("/tips/new")) return { view: "new-tip", search: window.location.search };
  if (path.startsWith("/reports/new")) {
    return { view: "new-report", reportType: new URLSearchParams(window.location.search).get("type") ?? "missing_person", search: window.location.search };
  }
  if (path.startsWith("/reports/") && path.endsWith("/manage")) return { view: "report-manage", slug: path.split("/")[2], search: window.location.search };
  if (path.startsWith("/reports/")) return { view: "report", slug: path.split("/")[2], search: window.location.search };
  if (path.startsWith("/resources/")) return { view: "resource", resourceId: path.split("/")[2], search: window.location.search };
  if (path.startsWith("/updates/")) return { view: "update", updateId: path.split("/")[2], search: window.location.search };
  if (path.startsWith("/organizations/apply")) return { view: "organization-apply", search: window.location.search };
  if (path.startsWith("/organizations/")) return { view: "organization", organizationId: path.split("/")[2], search: window.location.search };
  if (path.startsWith("/org")) return { view: "org-portal", search: window.location.search };
  if (path.startsWith("/map")) return { view: "map", search: window.location.search };
  if (path.startsWith("/updates")) return { view: "updates", search: window.location.search };
  if (path.startsWith("/organizations")) return { view: "organizations", search: window.location.search };
  if (path.startsWith("/volunteer")) return { view: "volunteer", search: window.location.search };
  if (path.startsWith("/data-request")) return { view: "data-request", search: window.location.search };
  if (path.startsWith("/search")) return { view: "search", search: window.location.search };
  if (path.startsWith("/reports")) return { view: "reports", search: window.location.search };
  if (path.startsWith("/resources")) return { view: "resources", search: window.location.search };
  if (path === "/admin" || path.startsWith("/admin/")) return { view: "admin", adminTab: adminPathTab(path), search: window.location.search };
  return { view: "home", search: window.location.search };
}

function navigate(path: string) {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
  const hash = path.split("#")[1];
  if (hash) {
    window.requestAnimationFrame(() => document.getElementById(hash)?.scrollIntoView({ block: "start" }));
  }
}

export default function App() {
  const [route, setRoute] = useState(parsePath);
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const loadConfig = useCallback(async () => {
    const result = await api.config();
    if (result.data) setConfig(result.data);
    return result;
  }, []);

  useEffect(() => {
    const onPop = () => setRoute(parsePath());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  const locale = config?.disaster.defaultLocale ?? "en";

  useSeo(route, config);

  return (
    <div className="app-shell">
      <Header config={config} onNavigate={navigate} />
      <IncidentStrip config={config} />
      {route.view === "home" && <Home config={config} locale={locale} onNavigate={navigate} />}
      {route.view === "search" && <SearchResults key={route.search} locale={locale} onNavigate={navigate} />}
      {route.view === "reports" && <Reports key={route.search} locale={locale} onNavigate={navigate} />}
      {route.view === "report" && route.slug && <ReportDetail slug={route.slug} config={config} locale={locale} onNavigate={navigate} />}
      {route.view === "report-manage" && route.slug && <ReportManage slug={route.slug} token={new URLSearchParams(route.search).get("token") ?? ""} config={config} onNavigate={navigate} />}
      {route.view === "new-report" && <ReportForm config={config} defaultType={route.reportType} locale={locale} onNavigate={navigate} />}
      {route.view === "pets" && <Pets key={route.search} locale={locale} onNavigate={navigate} />}
      {route.view === "pet" && route.slug && <ReportDetail slug={route.slug} config={config} locale={locale} onNavigate={navigate} />}
      {route.view === "new-tip" && <GeneralTip config={config} locale={locale} onNavigate={navigate} />}
      {route.view === "resources" && <Resources locale={locale} onNavigate={navigate} />}
      {route.view === "resource" && route.resourceId && <ResourceDetail resourceId={route.resourceId} config={config} locale={locale} onNavigate={navigate} />}
      {route.view === "map" && <MapView config={config} locale={locale} onNavigate={navigate} />}
      {route.view === "updates" && <Updates locale={locale} onNavigate={navigate} />}
      {route.view === "update" && route.updateId && <UpdateDetail updateId={route.updateId} locale={locale} onNavigate={navigate} />}
      {route.view === "organizations" && <Organizations locale={locale} onNavigate={navigate} />}
      {route.view === "organization-apply" && <OrganizationApply config={config} onNavigate={navigate} />}
      {route.view === "organization" && route.organizationId && <OrganizationDetail organizationId={route.organizationId} locale={locale} onNavigate={navigate} />}
      {route.view === "org-portal" && <OrganizationPortal locale={locale} onNavigate={navigate} />}
      {route.view === "volunteer" && <VolunteerForm config={config} onNavigate={navigate} />}
      {route.view === "data-request" && <DataRequestForm config={config} onNavigate={navigate} />}
      {route.view === "admin" && <Admin config={config} initialTab={route.adminTab ?? "overview"} onConfigRefresh={loadConfig} onNavigate={navigate} />}
      <Footer config={config} onNavigate={navigate} />
    </div>
  );
}

function IncidentStrip({ config }: { config: PublicConfig | null }) {
  return (
    <div className="incident-strip">
      <strong>{config?.disaster.profile ?? "Crisis"} response: {config?.disaster.affectedAreaLabel ?? "Crisis response"}</strong>
      <span>Information changes quickly. Verified labels do not mean every report is official.</span>
    </div>
  );
}

function Header({ config, onNavigate }: { config: PublicConfig | null; onNavigate: (path: string) => void }) {
  const [open, setOpen] = useState(false);
  const go = (path: string) => {
    setOpen(false);
    onNavigate(path);
  };
  const resourcesEnabled = resourceModulesEnabled(config);

  return (
    <header className="topbar">
      <button className="brand" onClick={() => go("/")}>
        <img src="/logo.svg" alt="" />
        <span>{config?.brand.name ?? "emergOS"}</span>
      </button>
      <button className="menu-toggle" aria-expanded={open} aria-controls="primary-navigation" onClick={() => setOpen((value) => !value)}>
        {open ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
        <span>Menu</span>
      </button>
      <nav id="primary-navigation" className={open ? "open" : ""} aria-label="Primary">
        {moduleEnabled(config, "missingPeople", true) && <button onClick={() => go("/reports?type=missing_person")}>Missing people</button>}
        {moduleEnabled(config, "foundPeople", true) && <button onClick={() => go("/reports?type=found_person")}>Found people</button>}
        {moduleEnabled(config, "missingPets", false) && <button onClick={() => go("/pets")}>Pets</button>}
        {resourcesEnabled && <button onClick={() => go("/resources")}>Resources</button>}
        {moduleEnabled(config, "publicUpdates", true) && <button onClick={() => go("/updates")}>Updates</button>}
        {moduleEnabled(config, "organizations", true) && <button onClick={() => go("/organizations")}>Organizations</button>}
        {moduleEnabled(config, "emergencyContacts", true) && <button onClick={() => go("/#contacts")}>Contacts</button>}
        {moduleEnabled(config, "maps", false) && <button onClick={() => go("/map")}>Map</button>}
        {moduleEnabled(config, "missingPeople", true) && <button className="nav-report" onClick={() => go("/reports/new?type=missing_person")}>Report</button>}
      </nav>
    </header>
  );
}

function Home({ config, locale, onNavigate }: { config: PublicConfig | null; locale: string; onNavigate: (path: string) => void }) {
  const [query, setQuery] = useState("");
  const [contacts, setContacts] = useState<Array<{ id: string; label: string; contact: string; description: string | null }>>([]);
  const [missingReports, setMissingReports] = useState<PublicReport[]>([]);
  const [foundReports, setFoundReports] = useState<PublicReport[]>([]);
  const [resources, setResources] = useState<PublicResource[]>([]);

  useEffect(() => {
    void Promise.all([
      api.contacts(),
      api.reports("?type=missing_person"),
      api.reports("?type=found_person"),
      api.resources()
    ]).then(([contactResult, missingResult, foundResult, resourceResult]) => {
      if (contactResult.data) setContacts(contactResult.data.contacts);
      if (missingResult.data) setMissingReports(missingResult.data.reports.slice(0, 6));
      if (foundResult.data) setFoundReports(foundResult.data.reports.slice(0, 3));
      if (resourceResult.data) setResources(resourceResult.data.resources.slice(0, 4));
    });
  }, []);

  function runSearch(event: FormEvent) {
    event.preventDefault();
    onNavigate(`/search?q=${encodeURIComponent(query)}`);
  }
  const showMissing = moduleEnabled(config, "missingPeople", true);
  const showFound = moduleEnabled(config, "foundPeople", true);
  const showTips = moduleEnabled(config, "tips", true);
  const showPets = moduleEnabled(config, "missingPets", false);
  const showResources = resourceModulesEnabled(config);
  const openShelters = resources.filter((resource) => resource.availabilityStatus === "open").length;
  const visibleContacts = moduleEnabled(config, "emergencyContacts", true);

  return (
    <main className="home-main">
      <section className="home-hero-grid">
        <div className="action-band emergency-home">
          <div className="title-block">
            <p className="eyebrow">Family reunification</p>
            <h1>Find people, report sightings, and locate urgent help.</h1>
            <p>A low-bandwidth public interface for the first critical hours after a crisis. Search first, then report only if there is no existing case.</p>
          </div>
          <form className="search-panel" onSubmit={runSearch}>
            <Search aria-hidden="true" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, city, shelter, hospital" />
            <button type="submit">Search</button>
          </form>
          <div className="cta-grid">
            {showMissing && <ActionButton important icon={<UserPlus />} label={t(locale, "reportMissing")} description="Create a public case with consent." onClick={() => onNavigate("/reports/new?type=missing_person")} />}
            {showFound && <ActionButton icon={<HeartHandshake />} label={t(locale, "reportFound")} description="Submit a shelter, hospital, or street sighting." onClick={() => onNavigate("/reports/new?type=found_person")} />}
            {showPets && <ActionButton icon={<PawPrint />} label={t(locale, "pets")} description="Report or search missing and found pets." onClick={() => onNavigate("/pets")} />}
            {showTips && <ActionButton icon={<TipIcon />} label={t(locale, "submitTip")} description="Share information even without a matching case." onClick={() => onNavigate("/tips/new")} />}
            {showResources && <ActionButton icon={<Hospital />} label={t(locale, "resources")} description="Open locations and support lines." onClick={() => onNavigate("/resources")} />}
            {moduleEnabled(config, "maps", false) && <ActionButton icon={<MapPin />} label="Map" description="View mapped reports and services." onClick={() => onNavigate("/map")} />}
            {moduleEnabled(config, "publicUpdates", true) && <ActionButton icon={<Bell />} label={t(locale, "publicUpdates")} description="Official guidance, corrections, and situation updates." onClick={() => onNavigate("/updates")} />}
            {moduleEnabled(config, "organizations", true) && <ActionButton icon={<ShieldCheck />} label="Organizations" description="Verified response groups and managed resources." onClick={() => onNavigate("/organizations")} />}
            {moduleEnabled(config, "volunteers", false) && <ActionButton icon={<ShieldCheck />} label="Volunteer" description="Register to support response teams." onClick={() => onNavigate("/volunteer")} />}
            {moduleEnabled(config, "privacyRequests", true) && <ActionButton icon={<BadgeCheck />} label="Privacy request" description="Corrections and takedown requests." onClick={() => onNavigate("/data-request")} />}
          </div>
        </div>
        <aside className="status-panel" aria-label="Current status">
          <div className="status-header">
            <h2>Current status</h2>
            <span><span aria-hidden="true" />Live</span>
          </div>
          <div className="status-grid">
            <article><strong>{missingReports.length}</strong><span>missing reports</span></article>
            <article><strong>{foundReports.length}</strong><span>found or safe</span></article>
            <article><strong>{openShelters}</strong><span>open shelters</span></article>
            <article><strong>{contacts.length}</strong><span>support lines</span></article>
          </div>
          <p className="official-note"><strong>Use official emergency channels first.</strong> emergOS helps organize community information, but does not replace emergency services, hospitals, or civil protection teams.</p>
        </aside>
      </section>

      <section className="priority-layout" aria-label="Emergency information">
        {showMissing && (
          <section className="priority-panel primary-feed">
            <SectionHeader
              eyebrow="Family reunification"
              title={t(locale, "missingPeople")}
              actionLabel="View all"
              onAction={() => onNavigate("/reports?type=missing_person")}
            />
            <ReportList reports={missingReports} onNavigate={onNavigate} compact />
          </section>
        )}

        <aside className="side-rail" aria-label="Emergency shortcuts">
          {showFound && (
            <section className="priority-panel">
              <SectionHeader
                eyebrow="Recently found"
                title={t(locale, "foundPeople")}
                actionLabel="View all"
                onAction={() => onNavigate("/reports?type=found_person")}
              />
              <ReportList reports={foundReports} onNavigate={onNavigate} compact />
            </section>
          )}

          {showResources && (
            <section className="priority-panel">
              <SectionHeader eyebrow="Directory" title={t(locale, "resources")} actionLabel="Open" onAction={() => onNavigate("/resources")} />
              <div className="resource-list compact">
                {resources.length ? resources.map((resource) => (
                  <article className="card" key={resource.id}>
                    <div className="badge-row">
                      <span className="badge">{resourceTypeLabels[resource.type]}</span>
                      <span className="badge muted">{resource.availabilityStatus}</span>
                    </div>
                    <strong>{resource.name}</strong>
                    <p>{[resource.city, resource.admin1].filter(Boolean).join(", ") || resource.address || "Location pending"}</p>
                  </article>
                )) : <p className="empty">No public resources have been published yet.</p>}
              </div>
            </section>
          )}

          {visibleContacts && <section className="priority-panel emergency-contacts" id="contacts">
            <SectionHeader eyebrow="Official and support lines" title={t(locale, "emergencyContacts")} />
            <div className="resource-list compact">
              {contacts.map((contact) => (
                <article className="card" key={contact.id}>
                  <strong>{contact.label}</strong>
                  <p>{contact.contact}</p>
                  {contact.description && <small>{contact.description}</small>}
                </article>
              ))}
            </div>
          </section>}
        </aside>
      </section>
    </main>
  );
}

function SectionHeader({
  eyebrow,
  title,
  actionLabel,
  onAction
}: {
  eyebrow: string;
  title: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="section-header">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
      </div>
      {actionLabel && onAction && <button className="secondary" onClick={onAction}>{actionLabel}</button>}
    </div>
  );
}

function ActionButton({
  icon,
  label,
  description,
  onClick,
  important = false
}: {
  icon: React.ReactNode;
  label: string;
  description?: string;
  onClick: () => void;
  important?: boolean;
}) {
  return (
    <button className={important ? "action-button important" : "action-button"} onClick={onClick}>
      {icon}
      <span>{label}</span>
      {description && <small>{description}</small>}
    </button>
  );
}

function SearchResults({ locale, onNavigate }: { locale: string; onNavigate: (path: string) => void }) {
  const params = new URLSearchParams(window.location.search);
  const [query, setQuery] = useState(params.get("q") ?? "");
  const [reports, setReports] = useState<PublicReport[]>([]);
  const [resources, setResources] = useState<PublicResource[]>([]);
  const [updates, setUpdates] = useState<PublicUpdate[]>([]);
  const [organizations, setOrganizations] = useState<PublicOrganization[]>([]);
  const [loading, setLoading] = useState(true);

  const searchParams = useMemo(() => {
    const next = new URLSearchParams();
    if (query) next.set("q", query);
    return next.toString() ? `?${next.toString()}` : "";
  }, [query]);

  useEffect(() => {
    setLoading(true);
    void api.search(searchParams).then((result) => {
      setLoading(false);
      if (!result.data) return;
      setReports(result.data.reports);
      setResources(result.data.resources);
      setUpdates(result.data.updates);
      setOrganizations(result.data.organizations);
    });
  }, [searchParams]);

  function runSearch(event: FormEvent) {
    event.preventDefault();
    window.history.replaceState({}, "", `/search${searchParams}`);
  }

  return (
    <main className="page-layout">
      <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "Search" }]} onNavigate={onNavigate} />
      <div className="page-header">
        <div>
          <p className="eyebrow">Public discovery</p>
          <h1>Search emergOS</h1>
        </div>
      </div>
      <form className="search-panel inline-search" onSubmit={runSearch}>
        <Search aria-hidden="true" />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t(locale, "search")} />
        <button type="submit">Search</button>
      </form>
      {loading ? <p>Loading search results...</p> : (
        <div className="search-results-grid">
          <section className="results-panel">
            <SectionHeader eyebrow="People and pets" title="Reports" />
            <ReportList reports={reports} onNavigate={onNavigate} compact />
          </section>
          <section className="results-panel">
            <SectionHeader eyebrow="Services" title={t(locale, "resources")} />
            <ResourceList resources={resources} onNavigate={onNavigate} />
          </section>
          <section className="results-panel">
            <SectionHeader eyebrow="Verified information" title={t(locale, "publicUpdates")} />
            {updates.length ? updates.map((update) => (
              <article className="card" key={update.id}>
                <div className="badge-row">
                  <span className="badge">{update.type.replaceAll("_", " ")}</span>
                  <span className="badge muted">{verificationLabels[update.verificationLevel]}</span>
                </div>
                <h2>{update.title}</h2>
                <p>{update.body}</p>
              </article>
            )) : <p className="empty">No public updates match this search.</p>}
          </section>
          <section className="results-panel">
            <SectionHeader eyebrow="Trusted groups" title="Organizations" />
            {organizations.length ? organizations.map((organization) => (
              <article className="card" key={organization.id}>
                <div className="badge-row">
                  <span className="badge">{organization.type}</span>
                  <span className="badge muted">{verificationLabels[organization.verificationStatus]}</span>
                </div>
                <h2>{organization.name}</h2>
                {organization.description && <p>{organization.description}</p>}
                {organization.contactPublic && <p>{organization.contactPublic}</p>}
              </article>
            )) : <p className="empty">No public organizations match this search.</p>}
          </section>
        </div>
      )}
    </main>
  );
}

function TipIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"></circle>
      <path d="M12 16V12"></path>
      <path d="M12.125 8.25H12M12.25 8.25C12.25 8.11193 12.1381 8 12 8C11.8619 8 11.75 8.11193 11.75 8.25C11.75 8.38807 11.8619 8.5 12 8.5C12.1381 8.5 12.25 8.38807 12.25 8.25Z"></path>
    </svg>
  );
}

function Reports({ locale, onNavigate }: { locale: string; onNavigate: (path: string) => void }) {
  const [reports, setReports] = useState<PublicReport[]>([]);
  const [query, setQuery] = useState(new URLSearchParams(window.location.search).get("q") ?? "");
  const [status, setStatus] = useState("");
  const [type, setType] = useState(new URLSearchParams(window.location.search).get("type") ?? "");
  const [loading, setLoading] = useState(true);

  const searchParams = useMemo(() => {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (status) params.set("status", status);
    if (type) params.set("type", type);
    return params.toString() ? `?${params.toString()}` : "";
  }, [query, status, type]);

  useEffect(() => {
    setLoading(true);
    void api.reports(searchParams).then((result) => {
      setLoading(false);
      if (result.data) setReports(result.data.reports);
    });
  }, [searchParams]);

  return (
    <main className="page-layout reports-page">
      <Breadcrumbs
        items={[
          { label: "Home", href: "/" },
          { label: type === "found_person" ? t(locale, "foundPeople") : type === "missing_person" ? t(locale, "missingPeople") : "Reports" }
        ]}
        onNavigate={onNavigate}
      />
      <div className="page-header">
        <div>
          <p className="eyebrow">Public search</p>
          <h1>{type === "found_person" ? t(locale, "foundPeople") : type === "missing_person" ? t(locale, "missingPeople") : `${t(locale, "missingPeople")} / ${t(locale, "foundPeople")}`}</h1>
        </div>
        <button onClick={() => onNavigate("/reports/new?type=missing_person")}>New report</button>
      </div>
      <section className="results-panel">
        <div className="filters">
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t(locale, "search")} />
          <select value={type} onChange={(event) => setType(event.target.value)}>
            <option value="">All report types</option>
            <option value="missing_person">Missing people</option>
            <option value="found_person">Found people</option>
          </select>
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">All statuses</option>
            {reportStatuses.map((value) => (
              <option key={value} value={value}>{statusLabels[value]}</option>
            ))}
          </select>
        </div>
        {loading ? <p>Loading reports...</p> : <ReportList reports={reports} onNavigate={onNavigate} />}
      </section>
    </main>
  );
}

function Pets({ locale, onNavigate }: { locale: string; onNavigate: (path: string) => void }) {
  const params = new URLSearchParams(window.location.search);
  const [pets, setPets] = useState<PublicPetReport[]>([]);
  const [query, setQuery] = useState(params.get("q") ?? "");
  const [type, setType] = useState(params.get("type") ?? "");
  const [status, setStatus] = useState(params.get("status") ?? "");
  const [loading, setLoading] = useState(true);

  const searchParams = useMemo(() => {
    const next = new URLSearchParams();
    if (query) next.set("q", query);
    if (type) next.set("type", type);
    if (status) next.set("status", status);
    return next.toString() ? `?${next.toString()}` : "";
  }, [query, type, status]);

  useEffect(() => {
    setLoading(true);
    void api.pets(searchParams).then((result) => {
      setLoading(false);
      if (result.data) setPets(result.data.pets);
    });
  }, [searchParams]);

  const missingCount = pets.filter((pet) => pet.type === "missing_pet").length;
  const foundCount = pets.filter((pet) => pet.type === "found_pet" || pet.status === "reunited").length;
  const shelterCount = pets.filter((pet) => pet.status === "in_shelter" || pet.status === "needs_foster").length;

  return (
    <main className="page-layout pets-page">
      <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: t(locale, "pets") }]} onNavigate={onNavigate} />
      <div className="page-header">
        <div>
          <p className="eyebrow">Pet reunification</p>
          <h1>{t(locale, "pets")}</h1>
        </div>
        <div className="button-row">
          <button className="secondary" onClick={() => onNavigate("/pets/new?type=found_pet")}><PawPrint aria-hidden="true" /> Found pet</button>
          <button onClick={() => onNavigate("/pets/new?type=missing_pet")}><PawPrint aria-hidden="true" /> Missing pet</button>
        </div>
      </div>
      <section className="pet-command-strip">
        <article><strong>{missingCount}</strong><span>missing</span></article>
        <article><strong>{foundCount}</strong><span>found or reunited</span></article>
        <article><strong>{shelterCount}</strong><span>foster or shelter help</span></article>
      </section>
      <section className="results-panel">
        <div className="filters resource-filters">
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search pet name, species, breed, color, city" />
          <select value={type} onChange={(event) => setType(event.target.value)}>
            <option value="">Missing and found pets</option>
            <option value="missing_pet">Missing pets</option>
            <option value="found_pet">Found pets</option>
          </select>
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">Any pet status</option>
            <option value="open">Open</option>
            <option value="found">Found</option>
            <option value="reunited">Reunited</option>
            <option value="needs_foster">Needs foster</option>
            <option value="in_shelter">In shelter</option>
          </select>
        </div>
        {loading ? <p>Loading pets...</p> : <ReportList reports={pets} onNavigate={onNavigate} />}
      </section>
    </main>
  );
}

function ReportList({ reports, onNavigate, compact = false }: { reports: PublicReport[]; onNavigate: (path: string) => void; compact?: boolean }) {
  if (!reports.length) return <p className="empty">No public reports match this search.</p>;

  return (
    <div className={compact ? "report-list compact-reports" : "report-grid"}>
      {reports.map((report) => (
        <article className="card report-card" key={report.id}>
          <div className="photo-frame">
            {report.photoUrl ? <img src={report.photoUrl} alt={report.displayName} /> : report.subjectType === "pet" ? <PawPrint aria-hidden="true" /> : <UserPlus aria-hidden="true" />}
          </div>
          <div className="report-card-body">
            <div className="badge-row">
              <span className="badge">{statusLabels[report.status]}</span>
              <span className="badge muted">{verificationLabels[report.verificationLevel]}</span>
            </div>
            <h2>{report.displayName}</h2>
            <p>{report.subjectType === "pet"
              ? [report.pet?.species, report.pet?.breed, report.pet?.color, report.lastSeenCity].filter(Boolean).join(" · ")
              : [report.ageRange ?? report.age, report.lastSeenCity, report.lastSeenAdmin1].filter(Boolean).join(" · ")}</p>
            {!compact && report.notesPublic && <p>{report.notesPublic}</p>}
            <button onClick={() => onNavigate(report.subjectType === "pet" ? `/pets/${report.publicSlug}` : `/reports/${report.publicSlug}`)}>View report</button>
          </div>
        </article>
      ))}
    </div>
  );
}

function ReportDetail({
  slug,
  config,
  locale,
  onNavigate
}: {
  slug: string;
  config: PublicConfig | null;
  locale: string;
  onNavigate: (path: string) => void;
}) {
  const [report, setReport] = useState<PublicReport | null>(null);
  const [message, setMessage] = useState("");
  const [contactMessage, setContactMessage] = useState("");
  const [abuseMessage, setAbuseMessage] = useState("");
  const [loadError, setLoadError] = useState("");
  const [showSafetyReview, setShowSafetyReview] = useState(false);
  const [activeAction, setActiveAction] = useState<"tip" | "contact">("tip");

  useEffect(() => {
    void api.report(slug).then((result) => {
      if (result.data) setReport(result.data.report);
      setLoadError(result.error ?? "");
    });
    setReport(null);
    setActiveAction("tip");
    setShowSafetyReview(false);
  }, [slug]);

  async function submitTip(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = new FormData(event.currentTarget);
    const result = await api.submitTip(slug, body);
    setMessage(result.error ?? "Tip submitted for review.");
    if (result.data) event.currentTarget.reset();
  }

  async function submitContactMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await api.submitContactMessage(slug, new FormData(event.currentTarget));
    setContactMessage(result.error ?? "Message submitted for moderation.");
    if (result.data) event.currentTarget.reset();
  }

  async function submitAbuseReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = new FormData(event.currentTarget);
    body.set("reportSlug", slug);
    const result = await api.submitAbuseReport(body);
    setAbuseMessage(result.error ?? "Request submitted for review.");
    if (result.data) event.currentTarget.reset();
  }

  if (!report && loadError) return <NotFoundPanel title="Report not available" message={loadError} onNavigate={onNavigate} />;
  if (!report) return <main className="page-layout"><p>Loading report...</p></main>;
  const canUseProtectedContact = report.contactMode === "protected_form" || report.contactMode === "organization_mediated";
  const isPet = report.subjectType === "pet" || report.type === "missing_pet" || report.type === "found_pet";
  const reportIndexHref = isPet ? "/pets" : `/reports?type=${report.type}`;
  const reportIndexLabel = isPet ? t(locale, "pets") : report.type === "found_person" ? t(locale, "foundPeople") : t(locale, "missingPeople");
  const seenLabel = report.type === "found_person" || report.type === "found_pet" ? "Found area" : "Last seen";

  return (
    <main className="page-layout detail-layout">
      <Breadcrumbs
        items={[
          { label: "Home", href: "/" },
          { label: reportIndexLabel, href: reportIndexHref },
          { label: report.displayName }
        ]}
        onNavigate={onNavigate}
      />
      <section className="card detail-card report-hero-card">
        <div className="detail-photo">
          {report.photoUrl ? <img src={report.photoUrl} alt={report.displayName} /> : isPet ? <PawPrint aria-hidden="true" /> : <UserPlus aria-hidden="true" />}
        </div>
        <div className="report-hero-content">
          <div className="badge-row">
            <span className="badge">{statusLabels[report.status]}</span>
            <span className="badge muted">{verificationLabels[report.verificationLevel]}</span>
          </div>
          <h1>{report.displayName}</h1>
          <p className="safety-note">{t(locale, "informationMayChange")}</p>
          {report.description && <p>{report.description}</p>}
          <dl className="meta-grid">
            {isPet && <div><dt>Pet details</dt><dd>{[report.pet?.species, report.pet?.breed, report.pet?.color].filter(Boolean).join(", ") || "Not provided"}</dd></div>}
            {isPet && <div><dt>Markings</dt><dd>{report.pet?.markings ?? "Not provided"}</dd></div>}
            <div><dt>{seenLabel}</dt><dd>{report.lastSeenText ?? "Not provided"}</dd></div>
            <div><dt>Location</dt><dd>{[report.lastSeenCity, report.lastSeenAdmin1].filter(Boolean).join(", ") || "Not provided"}</dd></div>
            <div><dt>Updated</dt><dd>{new Date(report.updatedAt).toLocaleString()}</dd></div>
            <div><dt>Contact</dt><dd>{report.publicContactValue ? `${report.publicContactType}: ${report.publicContactValue}` : "Protected contact"}</dd></div>
          </dl>
          <div className="button-row flyer-actions">
            <a className="button" href={`/reports/${report.publicSlug}/print${isPet ? "?format=pet" : ""}`} target="_blank" rel="noreferrer">
              <Printer aria-hidden="true" /> {isPet ? "Pet flyer" : t(locale, "printFlyer")}
            </a>
            <a className="button secondary" href={`/reports/${report.publicSlug}/print?format=a5`} target="_blank" rel="noreferrer">A5</a>
            <a className="button secondary" href={`/reports/${report.publicSlug}/print?format=mini4`} target="_blank" rel="noreferrer">Mini 4-up</a>
            <a className="button secondary" href={`/reports/${report.publicSlug}/print?format=poster`} target="_blank" rel="noreferrer">QR poster</a>
            <button className="secondary" onClick={() => document.getElementById("submit-tip")?.scrollIntoView({ block: "start" })}>Submit a tip</button>
            {reportMapState(report) === "mapped" && <button className="secondary" onClick={() => onNavigate(`/map?type=report&id=${report.id}`)}>Open map</button>}
          </div>
        </div>
      </section>

      <section className="card case-action-panel" id="submit-tip">
        <div className="case-action-header">
          <div>
            <p className="eyebrow">Help with this case</p>
            <h2>Share useful information</h2>
          </div>
          <span className="badge muted">Reviewed before publishing</span>
        </div>

        <div className="case-action-tabs" role="tablist" aria-label="Case actions">
          <button className={activeAction === "tip" ? "active" : ""} type="button" onClick={() => setActiveAction("tip")}>
            Submit a tip
          </button>
          {canUseProtectedContact && (
            <button className={activeAction === "contact" ? "active" : ""} type="button" onClick={() => setActiveAction("contact")}>
              Protected contact
            </button>
          )}
        </div>

        {activeAction === "tip" && (
          <form className="stacked-form polished-form case-form-grid" onSubmit={submitTip}>
            <label className="full-span">
              Information
              <textarea name="body" required minLength={5} placeholder="What did you see or learn? Include time, direction of travel, clothing, or who confirmed it." />
            </label>
            <label>
              Location or sighting area
              <input name="locationText" placeholder="Street, shelter, hospital, neighborhood" />
            </label>
            <label>
              Your contact, optional
              <input name="tipperContact" placeholder="Phone, WhatsApp, or email" />
            </label>
            <label className="full-span">
              Photo, optional
              <input name="photo" type="file" accept="image/png,image/jpeg,image/webp" />
            </label>
            {config?.turnstileSiteKey && <div className="cf-turnstile full-span" data-sitekey={config.turnstileSiteKey} data-action="tip"></div>}
            <button className="full-span" type="submit">Submit tip</button>
            {message && <p className="form-message full-span">{message}</p>}
          </form>
        )}

        {activeAction === "contact" && canUseProtectedContact && (
          <form className="stacked-form polished-form case-form-grid" onSubmit={submitContactMessage}>
            <label>
              Your name, optional
              <input name="senderName" />
            </label>
            <label>
              Your contact
              <input name="senderContact" required placeholder="How responders can reach you" />
            </label>
            <label className="full-span">
              Message
              <textarea name="body" required minLength={10} />
            </label>
            {config?.turnstileSiteKey && <div className="cf-turnstile full-span" data-sitekey={config.turnstileSiteKey} data-action="contact"></div>}
            <button className="full-span" type="submit">Send protected message</button>
            {contactMessage && <p className="form-message full-span">{contactMessage}</p>}
          </form>
        )}

        {report.publicContactValue && (
          <div className="direct-contact-note">
            <strong>Public contact</strong>
            <span>{report.publicContactType}: {report.publicContactValue}</span>
          </div>
        )}

        <div className="case-secondary-action">
          {!showSafetyReview ? (
            <button className="inline-link" type="button" onClick={() => setShowSafetyReview(true)}>
              Report incorrect or unsafe information
            </button>
          ) : (
            <section className="safety-request-inline">
              <div className="form-card-header compact">
                <div>
                  <p className="eyebrow">Safety controls</p>
                  <h2>Request review</h2>
                </div>
                <button className="inline-link" type="button" onClick={() => setShowSafetyReview(false)}>Hide</button>
              </div>
              <form className="stacked-form polished-form case-form-grid" onSubmit={submitAbuseReport}>
                <label>
                  Reason
                  <select name="reason" required>
                    <option value="unsafe_private_information">Unsafe private information</option>
                    <option value="false_or_misleading">False or misleading report</option>
                    <option value="harassment_or_doxxing">Harassment or doxxing</option>
                    <option value="remove_by_request">Remove by request</option>
                  </select>
                </label>
                <label>
                  Your contact, optional
                  <input name="requesterContact" />
                </label>
                <label className="full-span">
                  Details
                  <textarea name="details" />
                </label>
                {config?.turnstileSiteKey && <div className="cf-turnstile full-span" data-sitekey={config.turnstileSiteKey} data-action="abuse"></div>}
                <button className="secondary full-span" type="submit">Submit request</button>
                {abuseMessage && <p className="form-message full-span">{abuseMessage}</p>}
              </form>
            </section>
          )}
        </div>
      </section>

    </main>
  );
}

function ReportManage({ slug, token, config, onNavigate }: { slug: string; token: string; config: PublicConfig | null; onNavigate: (path: string) => void }) {
  const [report, setReport] = useState<PublicReport | null>(null);
  const [events, setEvents] = useState<Array<Record<string, unknown>>>([]);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!token) {
      setMessage("Manage token is missing.");
      return;
    }
    void api.reportManage(slug, token).then((result) => {
      if (result.data) {
        setReport(result.data.report);
        setEvents(result.data.statusEvents);
      }
      setMessage(result.error ?? "");
    });
  }, [slug, token]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await api.updateReportManage(slug, token, new FormData(event.currentTarget));
    if (result.data?.report) setReport(result.data.report);
    setMessage(result.error ?? "Report update saved. Public changes may require moderation.");
  }

  if (!report && message) return <NotFoundPanel title="Manage link unavailable" message={message} onNavigate={onNavigate} />;
  if (!report) return <main className="page-layout"><p>Loading manage page...</p></main>;

  return (
    <main className="page-layout form-page">
      <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "Report", href: `/reports/${slug}` }, { label: "Manage" }]} onNavigate={onNavigate} />
      <div className="page-header">
        <div>
          <p className="eyebrow">Private reporter link</p>
          <h1>Manage {report.displayName}</h1>
        </div>
        <button className="secondary" onClick={() => onNavigate(`/reports/${slug}`)}>Open public page</button>
      </div>
      <section className="card detail-card">
        <div>
          <p className="safety-note">Keep this link private. Updates that add public details or photos are reviewed before publishing.</p>
          <form className="stacked-form emergency-form" onSubmit={submit}>
            <label>
              Status
              <select name="status" defaultValue={report.status}>
                {reportStatuses.map((status) => <option value={status} key={status}>{statusLabels[status]}</option>)}
              </select>
            </label>
            <label>
              Location precision
              <select name="locationPrecision" defaultValue={report.locationPrecision}>
                <option value="exact">Exact</option>
                <option value="area">Area</option>
                <option value="city">City only</option>
                <option value="hidden">Hide from map</option>
              </select>
            </label>
            <label className="full-span">
              Last seen or latest known area
              <input name="lastSeenText" defaultValue={report.lastSeenText ?? ""} />
            </label>
            <div className="field-grid full-span">
              <label>
                City
                <input name="lastSeenCity" defaultValue={report.lastSeenCity ?? ""} />
              </label>
              <label>
                State or region
                <input name="lastSeenAdmin1" defaultValue={report.lastSeenAdmin1 ?? ""} />
              </label>
            </div>
            <div className="field-grid full-span">
              <label>
                Latitude
                <input name="lastSeenLat" inputMode="decimal" defaultValue={report.lastSeenLat ?? ""} />
              </label>
              <label>
                Longitude
                <input name="lastSeenLng" inputMode="decimal" defaultValue={report.lastSeenLng ?? ""} />
              </label>
            </div>
            <label className="full-span">
              Public note
              <textarea name="notesPublic" defaultValue={report.notesPublic ?? ""} />
            </label>
            <label className="full-span">
              Add or replace photo
              <input name="photo" type="file" accept="image/png,image/jpeg,image/webp" />
            </label>
            {config?.turnstileSiteKey && <div className="cf-turnstile full-span" data-sitekey={config.turnstileSiteKey} data-action="report_manage"></div>}
            <button className="full-span" type="submit">Save report update</button>
            {message && <p className="form-message full-span">{message}</p>}
          </form>
        </div>
        <aside className="results-panel">
          <h2>Status history</h2>
          {events.map((event, index) => (
            <article className="admin-row" key={`${String(event.created_at)}-${index}`}>
              <div>
                <strong>{String(event.new_status ?? "status")}</strong>
                <p>{String(event.source_note ?? event.source_type ?? "Update")}</p>
                <small>{String(event.created_at ?? "")}</small>
              </div>
            </article>
          ))}
          {!events.length && <p className="empty">No status history yet.</p>}
        </aside>
      </section>
    </main>
  );
}

function ReportForm({
  config,
  defaultType,
  locale,
  onNavigate
}: {
  config: PublicConfig | null;
  defaultType?: string;
  locale: string;
  onNavigate: (path: string) => void;
}) {
  const [contactMode, setContactMode] = useState("protected_form");
  const [message, setMessage] = useState("");
  const availableReportTypes = reportTypes.filter((type) => {
    if (type === "missing_pet" || type === "found_pet") return moduleEnabled(config, "missingPets", false);
    if (type === "missing_person") return moduleEnabled(config, "missingPeople", true);
    if (type === "found_person") return moduleEnabled(config, "foundPeople", true);
    return true;
  });
  const defaultReportType = defaultType && availableReportTypes.includes(defaultType as never) ? defaultType : availableReportTypes[0] ?? "missing_person";
  const [selectedType, setSelectedType] = useState(defaultReportType);
  const reportCopy = reportFormCopy(selectedType, locale);
  const isPetReport = selectedType === "missing_pet" || selectedType === "found_pet";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = new FormData(event.currentTarget);
    body.set("contactMode", contactMode);
    const result = await api.createReport(body);
    if (result.error) {
      setMessage(result.error);
      return;
    }
    if (!result.data) {
      setMessage("Report submission did not return a public listing.");
      return;
    }
    onNavigate(result.data.manageUrl);
  }

  return (
    <main className="page-layout form-page">
      <Breadcrumbs
        items={[
          { label: "Home", href: "/" },
          { label: reportCopy.title }
        ]}
        onNavigate={onNavigate}
      />
      <div className="page-header">
        <div>
          <p className="eyebrow">{reportCopy.eyebrow}</p>
          <h1>{reportCopy.title}</h1>
        </div>
      </div>
      <form className="card stacked-form emergency-form" onSubmit={submit}>
        <label className="full-span">
          Report type
          <select name="type" value={selectedType} onChange={(event) => setSelectedType(event.target.value)}>
            {availableReportTypes.map((type) => <option key={type} value={type}>{reportTypeLabel(type)}</option>)}
          </select>
        </label>
        <label className="full-span">
          {reportCopy.nameLabel}
          <input name="displayName" required minLength={2} />
        </label>
        <div className="field-grid">
          <label>
            {reportCopy.ageLabel}
            <input name="age" inputMode="numeric" />
          </label>
          <label>
            {reportCopy.ageRangeLabel}
            <input name="ageRange" placeholder={reportCopy.ageRangePlaceholder} />
          </label>
        </div>
        {isPetReport && (
          <fieldset className="form-section full-span">
            <legend>Pet details</legend>
            <p>Public details help owners and shelters match safely. Microchip and medical notes stay private for moderators.</p>
            <div className="field-grid">
              <label>
                Species
                <input name="species" placeholder="Dog, cat, bird" />
              </label>
              <label>
                Breed
                <input name="breed" placeholder="Mixed breed, tabby, poodle" />
              </label>
            </div>
            <div className="field-grid">
              <label>
                Color
                <input name="color" placeholder="Brown and white" />
              </label>
              <label>
                Markings
                <input name="markings" placeholder="Collar, spots, scars, tags" />
              </label>
            </div>
            <div className="field-grid">
              <label>
                Microchip, private
                <input name="microchipPrivate" placeholder="Chip number or vet note" />
              </label>
              <label>
                Medical notes, private
                <input name="medicalNotesPrivate" placeholder="Medication, injuries, special handling" />
              </label>
            </div>
          </fieldset>
        )}
        <label className="full-span">
          {reportCopy.descriptionLabel}
          <textarea name="description" />
        </label>
        <div className="field-grid">
          <label>
            {reportCopy.lastSeenLabel}
            <input name="lastSeenText" required />
          </label>
          <label>
            City
            <input name="lastSeenCity" />
          </label>
        </div>
        <fieldset className="form-section full-span">
          <legend>{reportCopy.mapLegend}</legend>
          <p>Only add coordinates if publishing this area is safe. Choose hidden when the location should stay off the public map.</p>
          <div className="field-grid">
            <label>
              State or region
              <input name="lastSeenAdmin1" />
            </label>
            <label>
              Location precision
              <select name="locationPrecision" defaultValue="area">
                <option value="exact">Exact</option>
                <option value="area">Area</option>
                <option value="city">City only</option>
                <option value="hidden">Hide from map</option>
              </select>
            </label>
          </div>
          <div className="field-grid">
            <label>
              Latitude
              <input name="lastSeenLat" inputMode="decimal" placeholder="10.5000" />
            </label>
            <label>
              Longitude
              <input name="lastSeenLng" inputMode="decimal" placeholder="-66.9167" />
            </label>
          </div>
        </fieldset>
        <label className="full-span">
          {reportCopy.notesLabel}
          <textarea name="notesPublic" />
        </label>
        <label className="full-span">
          Photo
          <input name="photo" type="file" accept="image/png,image/jpeg,image/webp" />
        </label>
        <fieldset className="contact-mode full-span">
          <legend>Contact visibility</legend>
          {contactModes.map((mode) => (
            <label key={mode}>
              <input type="radio" name="contactModeChoice" checked={contactMode === mode} onChange={() => setContactMode(mode)} />
              {mode === "public_direct" ? t(locale, "publicDirectContact") : mode === "protected_form" ? t(locale, "protectedContact") : t(locale, "organizationMediated")}
            </label>
          ))}
        </fieldset>
        {contactMode === "public_direct" && (
          <>
            <div className="field-grid">
              <label>
                Public contact type
                <select name="publicContactType">
                  <option value="phone">Phone</option>
                  <option value="whatsapp">WhatsApp</option>
                  <option value="email">Email</option>
                </select>
              </label>
              <label>
                Public contact value
                <input name="publicContactValue" />
              </label>
            </div>
            <label className="checkbox-row full-span">
              <input name="publicContactConsent" type="checkbox" value="yes" required />
              {t(locale, "publicContactConsent")}
            </label>
          </>
        )}
        <label className="full-span">
          Private reporter contact
          <input name="reporterContact" />
        </label>
        {config?.turnstileSiteKey && <div className="cf-turnstile" data-sitekey={config.turnstileSiteKey} data-action="report"></div>}
        <button className="full-span" type="submit">Submit report</button>
        {message && <p className="form-message error">{message}</p>}
      </form>
    </main>
  );
}

function reportTypeLabel(type: string): string {
  if (type === "missing_pet") return "Missing pet";
  if (type === "found_pet") return "Found pet";
  if (type === "found_person") return "Found person";
  return "Missing person";
}

function reportFormCopy(type: string, locale: string) {
  if (type === "missing_pet") {
    return {
      eyebrow: "Pet reunification",
      title: "Report missing pet",
      nameLabel: "Pet name or description",
      ageLabel: "Approx. age",
      ageRangeLabel: "Species or breed",
      ageRangePlaceholder: "Dog, cat, mixed breed",
      descriptionLabel: "Identifying details",
      lastSeenLabel: "Last seen area",
      mapLegend: "Optional last seen map location",
      notesLabel: "Public notes for responders"
    };
  }
  if (type === "found_pet") {
    return {
      eyebrow: "Pet reunification",
      title: "Report found pet",
      nameLabel: "Pet description",
      ageLabel: "Approx. age",
      ageRangeLabel: "Species or breed",
      ageRangePlaceholder: "Dog, cat, mixed breed",
      descriptionLabel: "Condition and identifying details",
      lastSeenLabel: "Found area",
      mapLegend: "Optional found-location map point",
      notesLabel: "Public notes for the owner"
    };
  }
  if (type === "found_person") {
    return {
      eyebrow: "Safe person report",
      title: t(locale, "reportFound"),
      nameLabel: "Name or description",
      ageLabel: "Age",
      ageRangeLabel: "Age range",
      ageRangePlaceholder: "Adult, child, 30-40",
      descriptionLabel: "Description",
      lastSeenLabel: "Found or safe area",
      mapLegend: "Optional map location",
      notesLabel: "Public notes"
    };
  }
  return {
    eyebrow: "Fast path first",
    title: t(locale, "reportMissing"),
    nameLabel: "Name or description",
    ageLabel: "Age",
    ageRangeLabel: "Age range",
    ageRangePlaceholder: "Adult, child, 30-40",
    descriptionLabel: "Description",
    lastSeenLabel: "Last seen area",
    mapLegend: "Optional map location",
    notesLabel: "Public notes"
  };
}

function GeneralTip({ config, locale, onNavigate }: { config: PublicConfig | null; locale: string; onNavigate: (path: string) => void }) {
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await api.submitGeneralTip(new FormData(event.currentTarget));
    setMessage(result.error ?? "Tip submitted for review.");
    if (result.data) event.currentTarget.reset();
  }

  return (
    <main className="page-layout form-page">
      <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: t(locale, "submitTip") }]} onNavigate={onNavigate} />
      <div className="page-header">
        <div>
          <p className="eyebrow">Community information</p>
          <h1>{t(locale, "submitTip")}</h1>
        </div>
        <button className="secondary" onClick={() => onNavigate("/reports")}>Browse reports first</button>
      </div>
      <form className="card stacked-form emergency-form" onSubmit={submit}>
        <p className="safety-note full-span">Use this when the information may help responders, but does not clearly belong to one public case yet.</p>
        <label className="full-span">
          Information
          <textarea name="body" required minLength={5} placeholder="What did you see, learn, or confirm? Include time, location, and source if safe." />
        </label>
        <div className="field-grid">
          <label>
            Location or area
            <input name="locationText" placeholder="Street, shelter, hospital, neighborhood" />
          </label>
          <label>
            Your contact, optional
            <input name="tipperContact" placeholder="Phone, WhatsApp, or email" />
          </label>
        </div>
        <label className="full-span">
          Photo, optional
          <input name="photo" type="file" accept="image/png,image/jpeg,image/webp" />
        </label>
        {config?.turnstileSiteKey && <div className="cf-turnstile full-span" data-sitekey={config.turnstileSiteKey} data-action="tip"></div>}
        <button className="full-span" type="submit">Submit tip</button>
        {message && <p className="form-message full-span">{message}</p>}
      </form>
    </main>
  );
}

function Resources({ locale, onNavigate }: { locale: string; onNavigate: (path: string) => void }) {
  const [resources, setResources] = useState<PublicResource[]>([]);
  const [query, setQuery] = useState("");
  const [type, setType] = useState("");
  const [availability, setAvailability] = useState("");

  useEffect(() => {
    void api.resources().then((result) => {
      if (result.data) setResources(result.data.resources);
    });
  }, []);

  const filteredResources = resources.filter((resource) => {
    const search = query.trim().toLowerCase();
    const matchesQuery = !search || [resource.name, resource.description, resource.address, resource.city, resource.admin1, resource.services, resource.currentNeeds, resource.acceptedGroups]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(search));
    const matchesType = !type || resource.type === type;
    const matchesAvailability = !availability || resource.availabilityStatus === availability;
    return matchesQuery && matchesType && matchesAvailability;
  });

  return (
    <main className="page-layout">
      <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: t(locale, "resources") }]} onNavigate={onNavigate} />
      <div className="page-header">
        <div>
          <p className="eyebrow">Verified directory</p>
          <h1>{t(locale, "resources")}</h1>
        </div>
      </div>
      <section className="results-panel">
        <div className="filters resource-filters">
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search resource, city, address" />
          <select value={type} onChange={(event) => setType(event.target.value)}>
            <option value="">All resource types</option>
            {resourceTypes.map((value) => <option value={value} key={value}>{resourceTypeLabels[value]}</option>)}
          </select>
          <select value={availability} onChange={(event) => setAvailability(event.target.value)}>
            <option value="">Any availability</option>
            <option value="open">Open</option>
            <option value="full">Full</option>
            <option value="closed">Closed</option>
            <option value="unknown">Unknown</option>
          </select>
        </div>
        <ResourceList resources={filteredResources} onNavigate={onNavigate} />
      </section>
    </main>
  );
}

function ResourceList({ resources, onNavigate, compact = false }: { resources: PublicResource[]; onNavigate: (path: string) => void; compact?: boolean }) {
  if (!resources.length) return <p className="empty">No public resources have been published yet.</p>;

  return (
    <div className={compact ? "resource-list compact" : "resource-list"}>
      {resources.map((resource) => (
        <article className="card resource-card" key={resource.id}>
          <div className="badge-row">
            <span className="badge">{resourceTypeLabels[resource.type]}</span>
            <span className={resource.availabilityStatus === "open" ? "badge success" : "badge muted"}>{resource.availabilityStatus}</span>
            <span className="badge muted">{verificationLabels[resource.verificationLevel]}</span>
            {isResourceStale(resource) && <span className="badge warning">Needs verification</span>}
            {resource.locationPrecision === "hidden" && <span className="badge warning">Map hidden</span>}
          </div>
          <h2>{resource.name}</h2>
          {resource.description && <p>{resource.description}</p>}
          {!compact && <dl className="resource-card-meta">
            <div><dt>Location</dt><dd><MapPin aria-hidden="true" /> {[resource.address, resource.city, resource.admin1].filter(Boolean).join(", ") || "Location pending"}</dd></div>
            <div><dt>Hours</dt><dd>{resource.hours ?? "Not provided"}</dd></div>
            <div><dt>Capacity</dt><dd>{resource.capacity ?? "Not provided"}</dd></div>
            <div><dt>Services</dt><dd>{resource.services ?? resource.supplies ?? "Not provided"}</dd></div>
            <div><dt>Needs</dt><dd>{resource.currentNeeds ?? "Not provided"}</dd></div>
            <div><dt>Map</dt><dd>{resourceMapState(resource) === "mapped" ? "Coordinates set" : resourceMapState(resource) === "hidden" ? "Hidden" : "No coordinates"}</dd></div>
          </dl>}
          <div className="button-row">
            <button onClick={() => onNavigate(`/resources/${resource.id}`)}>View resource</button>
            {resourceMapState(resource) === "mapped" && <button className="secondary" onClick={() => onNavigate(`/map?type=resource&id=${resource.id}`)}>Open map</button>}
          </div>
        </article>
      ))}
    </div>
  );
}

function ResourceDetail({
  resourceId,
  config,
  locale,
  onNavigate
}: {
  resourceId: string;
  config: PublicConfig | null;
  locale: string;
  onNavigate: (path: string) => void;
}) {
  const [resource, setResource] = useState<PublicResource | null>(null);
  const [message, setMessage] = useState("");
  const [showIssueForm, setShowIssueForm] = useState(false);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    void api.resource(resourceId).then((result) => {
      if (result.data) setResource(result.data.resource);
      setLoadError(result.error ?? "");
    });
    setResource(null);
    setShowIssueForm(false);
  }, [resourceId]);

  async function submitAbuseReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = new FormData(event.currentTarget);
    body.set("resourceId", resourceId);
    const result = await api.submitAbuseReport(body);
    setMessage(result.error ?? "Request submitted for review.");
    if (result.data) event.currentTarget.reset();
  }

  if (!resource && loadError) return <NotFoundPanel title="Resource not available" message={loadError} onNavigate={onNavigate} />;
  if (!resource) return <main className="page-layout"><p>Loading resource...</p></main>;

  return (
    <main className="page-layout resource-detail-page">
      <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: t(locale, "resources"), href: "/resources" }, { label: resource.name }]} onNavigate={onNavigate} />
      <section className="card resource-hero-card">
        <div className="resource-hero-main">
          <div className="badge-row">
            <span className="badge">{resourceTypeLabels[resource.type]}</span>
            <span className={resource.availabilityStatus === "open" ? "badge success" : "badge muted"}>{resource.availabilityStatus}</span>
            <span className="badge muted">{verificationLabels[resource.verificationLevel]}</span>
            {isResourceStale(resource) && <span className="badge warning">Needs verification</span>}
          </div>
          <h1>{resource.name}</h1>
          {resource.description && <p>{resource.description}</p>}
          <dl className="meta-grid">
            <div><dt>Location</dt><dd>{[resource.address, resource.city, resource.admin1].filter(Boolean).join(", ") || "Not provided"}</dd></div>
            <div><dt>Hours</dt><dd>{resource.hours ?? "Not provided"}</dd></div>
            <div><dt>Capacity</dt><dd>{resource.capacity ?? "Not provided"}</dd></div>
            <div><dt>Accepted groups</dt><dd>{resource.acceptedGroups ?? "Not specified"}</dd></div>
            <div><dt>Accessibility</dt><dd>{resource.accessibility ?? "Not specified"}</dd></div>
            <div><dt>Services</dt><dd>{resource.services ?? resource.supplies ?? "Not provided"}</dd></div>
            <div><dt>Current needs</dt><dd>{resource.currentNeeds ?? "Not provided"}</dd></div>
            <div><dt>Contact</dt><dd>{resource.contactPublic ?? "Not provided"}</dd></div>
            <div><dt>Donation link</dt><dd>{resource.donationUrl ? <a href={resource.donationUrl} target="_blank" rel="noreferrer">Verified donation link</a> : "Not provided"}</dd></div>
            <div><dt>Source</dt><dd>{resource.sourceUrl ? <a href={resource.sourceUrl} target="_blank" rel="noreferrer">Open source</a> : "Not provided"}</dd></div>
            <div><dt>Last verified</dt><dd>{resource.lastVerifiedAt ? new Date(resource.lastVerifiedAt).toLocaleString() : "Not verified yet"}</dd></div>
          </dl>
        </div>
        {resourceMapState(resource) === "mapped" && moduleEnabled(config, "maps", false) && (
          <div className="resource-map-preview">
            <LeafletMap
              features={[resourceToMapFeature(resource)]}
              config={config}
              selectedFeatureId={resource.id}
              onNavigate={() => undefined}
            />
          </div>
        )}
      </section>
      <section className={showIssueForm ? "card resource-issue-card" : "detail-issue-link"}>
        {resourceMapState(resource) === "mapped" && (
          <button className="inline-link" type="button" onClick={() => onNavigate(`/map?type=resource&id=${resource.id}`)}>Open this resource on the public map</button>
        )}
        {!showIssueForm ? (
          <button className="inline-link" type="button" onClick={() => setShowIssueForm(true)}>Report stale or unsafe resource information</button>
        ) : (
          <>
            <div className="form-card-header compact">
              <div>
                <p className="eyebrow">Safety and accuracy</p>
                <h2>Report a problem</h2>
              </div>
              <button className="inline-link" type="button" onClick={() => setShowIssueForm(false)}>Hide</button>
            </div>
            <form className="stacked-form polished-form case-form-grid" onSubmit={submitAbuseReport}>
              <label>
                Reason
                <select name="reason" required>
                  <option value="stale_resource">Information is stale</option>
                  <option value="unsafe_location">Unsafe location details</option>
                  <option value="fake_resource">Fake or misleading listing</option>
                  <option value="remove_by_request">Remove by request</option>
                </select>
              </label>
              <label>
                Your contact, optional
                <input name="requesterContact" />
              </label>
              <label className="full-span">
                Details
                <textarea name="details" />
              </label>
              {config?.turnstileSiteKey && <div className="cf-turnstile full-span" data-sitekey={config.turnstileSiteKey} data-action="abuse"></div>}
              <button className="secondary full-span" type="submit">Submit request</button>
              {message && <p className="form-message full-span">{message}</p>}
            </form>
          </>
        )}
      </section>
    </main>
  );
}

function Updates({ locale, onNavigate }: { locale: string; onNavigate: (path: string) => void }) {
  const [updates, setUpdates] = useState<PublicUpdate[]>([]);
  const [type, setType] = useState("");

  useEffect(() => {
    void api.updates().then((result) => {
      if (result.data) setUpdates(result.data.updates);
    });
  }, []);

  const filtered = updates.filter((update) => !type || update.type === type);
  const updateTypes = Array.from(new Set(updates.map((update) => update.type))).sort();

  return (
    <main className="page-layout">
      <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: t(locale, "publicUpdates") }]} onNavigate={onNavigate} />
      <div className="page-header">
        <div>
          <p className="eyebrow">Verified information</p>
          <h1>{t(locale, "publicUpdates")}</h1>
        </div>
      </div>
      <section className="results-panel">
        <div className="filters compact-filters">
          <select value={type} onChange={(event) => setType(event.target.value)}>
            <option value="">All update types</option>
            {updateTypes.map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}
          </select>
        </div>
        <div className="update-timeline">
          {filtered.map((update) => (
            <article className="card update-card" key={update.id}>
              <div className="badge-row">
                <span className="badge">{update.type.replaceAll("_", " ")}</span>
                <span className="badge muted">{verificationLabels[update.verificationLevel]}</span>
                {update.pinned && <span className="badge warning">Pinned</span>}
              </div>
              <h2>{update.title}</h2>
              <p>{update.body}</p>
              <small>{new Date(update.publishedAt).toLocaleString()} {update.source ? `· ${update.source}` : ""}</small>
              <button className="secondary" onClick={() => onNavigate(`/updates/${update.id}`)}>Open update</button>
            </article>
          ))}
          {!filtered.length && <p className="empty">No public updates are available yet.</p>}
        </div>
      </section>
    </main>
  );
}

function UpdateDetail({ updateId, locale, onNavigate }: { updateId: string; locale: string; onNavigate: (path: string) => void }) {
  const [update, setUpdate] = useState<PublicUpdate | null>(null);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    void api.update(updateId).then((result) => {
      if (result.data) setUpdate(result.data.update);
      setLoadError(result.error ?? "");
    });
    setUpdate(null);
  }, [updateId]);

  if (!update && loadError) return <NotFoundPanel title="Update not available" message={loadError} onNavigate={onNavigate} />;
  if (!update) return <main className="page-layout"><p>Loading update...</p></main>;

  return (
    <main className="page-layout detail-layout update-detail-page">
      <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: t(locale, "publicUpdates"), href: "/updates" }, { label: update.title }]} onNavigate={onNavigate} />
      <section className="card update-detail-card">
        <div className="badge-row">
          <span className="badge">{update.type.replaceAll("_", " ")}</span>
          <span className="badge muted">{verificationLabels[update.verificationLevel]}</span>
          {update.pinned && <span className="badge warning">Pinned</span>}
        </div>
        <h1>{update.title}</h1>
        <p className="safety-note">{t(locale, "informationMayChange")}</p>
        <p>{update.body}</p>
        <dl className="meta-grid">
          <div><dt>Published</dt><dd>{new Date(update.publishedAt).toLocaleString()}</dd></div>
          <div><dt>Source</dt><dd>{update.source ?? "Not provided"}</dd></div>
          <div><dt>Locale</dt><dd>{update.locale}</dd></div>
          <div><dt>Verification</dt><dd>{verificationLabels[update.verificationLevel]}</dd></div>
        </dl>
      </section>
    </main>
  );
}

function Organizations({ locale, onNavigate }: { locale: string; onNavigate: (path: string) => void }) {
  const [organizations, setOrganizations] = useState<PublicOrganization[]>([]);
  const [query, setQuery] = useState("");

  useEffect(() => {
    void api.organizations().then((result) => {
      if (result.data) setOrganizations(result.data.organizations);
    });
  }, []);

  const filtered = organizations.filter((organization) => {
    const search = query.trim().toLowerCase();
    return !search || [organization.name, organization.type, organization.description, organization.contactPublic]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(search));
  });

  return (
    <main className="page-layout">
      <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "Organizations" }]} onNavigate={onNavigate} />
      <div className="page-header">
        <div>
          <p className="eyebrow">Trusted groups</p>
          <h1>Organizations</h1>
        </div>
        <button onClick={() => onNavigate("/organizations/apply")}>Apply as organization</button>
      </div>
      <section className="results-panel">
        <div className="filters compact-filters">
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search organization, type, contact" />
        </div>
        <div className="organization-grid">
          {filtered.map((organization) => (
            <article className="card organization-card" key={organization.id}>
              <div className="badge-row">
                <span className="badge">{organization.type}</span>
                <span className="badge muted">{verificationLabels[organization.verificationStatus]}</span>
              </div>
              <h2>{organization.name}</h2>
              {organization.description && <p>{organization.description}</p>}
              <dl className="resource-card-meta">
                <div><dt>Contact</dt><dd>{organization.contactPublic ?? "Not provided"}</dd></div>
                <div><dt>Website</dt><dd>{organization.website ? <a href={organization.website} target="_blank" rel="noreferrer">Open website</a> : "Not provided"}</dd></div>
              </dl>
              <button className="secondary" onClick={() => onNavigate(`/organizations/${organization.id}`)}>Open organization</button>
            </article>
          ))}
          {!filtered.length && <p className="empty">No verified organizations are available yet.</p>}
        </div>
      </section>
    </main>
  );
}

function OrganizationApply({ config, onNavigate }: { config: PublicConfig | null; onNavigate: (path: string) => void }) {
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await api.applyOrganization(new FormData(event.currentTarget));
    setMessage(result.error ?? "Application submitted for verification.");
    if (result.data) event.currentTarget.reset();
  }

  return (
    <main className="page-layout form-page">
      <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "Organizations", href: "/organizations" }, { label: "Apply" }]} onNavigate={onNavigate} />
      <div className="page-header">
        <div>
          <p className="eyebrow">Verified partners</p>
          <h1>Apply as an organization</h1>
        </div>
      </div>
      <form className="card stacked-form emergency-form" onSubmit={submit}>
        <label>
          Organization name
          <input name="name" required />
        </label>
        <label>
          Type
          <input name="type" required placeholder="NGO, shelter, hospital, volunteer group" />
        </label>
        <label className="full-span">
          Description
          <textarea name="description" />
        </label>
        <label>
          Website
          <input name="website" placeholder="https://..." />
        </label>
        <label>
          Public contact
          <input name="contactPublic" placeholder="Public phone, email, or URL" />
        </label>
        <label>
          Private verification contact
          <input name="contactPrivate" required placeholder="Admin-only email or phone" />
        </label>
        <label className="full-span">
          Verification evidence
          <textarea name="verificationEvidence" placeholder="Official website, registration, known responders, or how moderators can verify you." />
        </label>
        {config?.turnstileSiteKey && <div className="cf-turnstile full-span" data-sitekey={config.turnstileSiteKey} data-action="organization_application"></div>}
        <button className="full-span" type="submit">Submit application</button>
        {message && <p className="form-message full-span">{message}</p>}
      </form>
    </main>
  );
}

function OrganizationDetail({ organizationId, locale, onNavigate }: { organizationId: string; locale: string; onNavigate: (path: string) => void }) {
  const [detail, setDetail] = useState<PublicOrganizationDetail | null>(null);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    void api.organization(organizationId).then((result) => {
      if (result.data) setDetail(result.data);
      setLoadError(result.error ?? "");
    });
    setDetail(null);
  }, [organizationId]);

  if (!detail && loadError) return <NotFoundPanel title="Organization not available" message={loadError} onNavigate={onNavigate} />;
  if (!detail) return <main className="page-layout"><p>Loading organization...</p></main>;
  const { organization, resources } = detail;

  return (
    <main className="page-layout organization-detail-page">
      <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "Organizations", href: "/organizations" }, { label: organization.name }]} onNavigate={onNavigate} />
      <section className="card organization-detail-card">
        <div className="organization-detail-main">
          <div className="badge-row">
            <span className="badge">{organization.type}</span>
            <span className="badge muted">{verificationLabels[organization.verificationStatus]}</span>
          </div>
          <h1>{organization.name}</h1>
          {organization.description && <p>{organization.description}</p>}
          <dl className="meta-grid">
            <div><dt>Contact</dt><dd>{organization.contactPublic ?? "Not provided"}</dd></div>
            <div><dt>Website</dt><dd>{organization.website ? <a href={organization.website} target="_blank" rel="noreferrer">Open website</a> : "Not provided"}</dd></div>
            <div><dt>Updated</dt><dd>{new Date(organization.updatedAt).toLocaleString()}</dd></div>
            <div><dt>Resources</dt><dd>{resources.length}</dd></div>
          </dl>
        </div>
        <aside className="organization-resource-panel">
          <h2>{t(locale, "resources")}</h2>
          <ResourceList resources={resources} onNavigate={onNavigate} compact />
        </aside>
      </section>
    </main>
  );
}

function OrganizationPortal({ locale, onNavigate }: { locale: string; onNavigate: (path: string) => void }) {
  const [email, setEmail] = useState(localStorage.getItem("emergos-org-email") ?? "");
  const [organizations, setOrganizations] = useState<PublicOrganization[]>([]);
  const [reports, setReports] = useState<PublicReport[]>([]);
  const [resources, setResources] = useState<PublicResource[]>([]);
  const [volunteers, setVolunteers] = useState<VolunteerRegistration[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState("");
  const [message, setMessage] = useState("");

  async function loadPortal() {
    localStorage.setItem("emergos-org-email", email);
    const result = await api.orgDashboard(email);
    if (result.data) {
      setOrganizations(result.data.organizations);
      setReports(result.data.reports);
      setResources(result.data.resources);
      setVolunteers(result.data.volunteers);
      setSelectedOrgId((current) => current || result.data.organizations[0]?.id || "");
    }
    setMessage(result.error ?? "");
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const orgId = String(form.get("organizationId") ?? "");
    const result = await api.updateOrgProfile(email, orgId, formObject(form));
    setMessage(result.error ?? "Organization profile saved.");
    await loadPortal();
  }

  useEffect(() => {
    if (email) void loadPortal();
  }, []);

  const selectedOrg = organizations.find((organization) => organization.id === selectedOrgId) ?? organizations[0] ?? null;
  const scopedResources = selectedOrg ? resources.filter((resource) => resource.organizationId === selectedOrg.id) : resources;
  const scopedReports = selectedOrg ? reports.filter((report) => report.assignedOrganizationId === selectedOrg.id) : reports;

  return (
    <main className="page-layout org-portal-page">
      <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "Organization portal" }]} onNavigate={onNavigate} />
      <div className="page-header">
        <div>
          <p className="eyebrow">Verified partners</p>
          <h1>Organization portal</h1>
        </div>
        <button onClick={() => void loadPortal()}>Load workspace</button>
      </div>
      <section className="card stacked-form">
        <label>
          Organization member email
          <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="member@example.org" />
        </label>
        <p>Production access should come from Cloudflare Access. This local field only selects the member workspace during development.</p>
      </section>
      {message && <p className={message.toLowerCase().includes("error") || message.toLowerCase().includes("failed") ? "form-message error" : "form-message"}>{message}</p>}
      {organizations.length ? (
        <section className="org-portal-grid">
          <aside className="card org-switcher">
            <h2>Organizations</h2>
            {organizations.map((organization) => (
              <button className={selectedOrg?.id === organization.id ? "active" : ""} key={organization.id} onClick={() => setSelectedOrgId(organization.id)}>
                <Building2 aria-hidden="true" />
                <span>
                  <strong>{organization.name}</strong>
                  <small>{verificationLabels[organization.verificationStatus]}</small>
                </span>
              </button>
            ))}
          </aside>
          <section className="org-portal-main">
            {selectedOrg && (
              <form className="card stacked-form admin-form org-profile-form" key={selectedOrg.id} onSubmit={saveProfile}>
                <div className="form-card-header">
                  <div>
                    <p className="eyebrow">Public profile</p>
                    <h2>{selectedOrg.name}</h2>
                  </div>
                  <button className="secondary" type="button" onClick={() => onNavigate(`/organizations/${selectedOrg.id}`)}>Open public page</button>
                </div>
                <input name="organizationId" type="hidden" defaultValue={selectedOrg.id} />
                <input name="name" defaultValue={selectedOrg.name} />
                <input name="type" defaultValue={selectedOrg.type} />
                <input name="website" defaultValue={selectedOrg.website ?? ""} placeholder="Website" />
                <input name="contactPublic" defaultValue={selectedOrg.contactPublic ?? ""} placeholder="Public contact" />
                <textarea className="full-span" name="description" defaultValue={selectedOrg.description ?? ""} placeholder="Public description" />
                <button type="submit">Save profile</button>
              </form>
            )}
            <section className="metric-grid compact-metrics">
              <article className="metric"><span>Owned resources</span><strong>{scopedResources.length}</strong></article>
              <article className="metric"><span>Managed reports</span><strong>{scopedReports.length}</strong></article>
              <article className="metric"><span>Volunteers</span><strong>{volunteers.length}</strong></article>
            </section>
            <section className="card admin-action-panel">
              <SectionHeader eyebrow="Directory" title={t(locale, "resources")} actionLabel="Public list" onAction={() => onNavigate("/resources")} />
              <ResourceList resources={scopedResources.slice(0, 6)} onNavigate={onNavigate} compact />
            </section>
            <section className="card admin-action-panel">
              <SectionHeader eyebrow="Cases" title="Managed reports" actionLabel="All reports" onAction={() => onNavigate("/reports")} />
              <ReportList reports={scopedReports.slice(0, 6)} onNavigate={onNavigate} compact />
            </section>
          </section>
        </section>
      ) : (
        <section className="card empty-state-panel">
          <Building2 aria-hidden="true" />
          <div>
            <h2>No organization workspace loaded</h2>
            <p>Enter a member email and load the workspace, or apply for verification if the organization is not in emergOS yet.</p>
            <button className="secondary" onClick={() => onNavigate("/organizations/apply")}>Apply as organization</button>
          </div>
        </section>
      )}
    </main>
  );
}

function MapView({ config, locale, onNavigate }: { config: PublicConfig | null; locale: string; onNavigate: (path: string) => void }) {
  const [features, setFeatures] = useState<MapFeature[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [showReports, setShowReports] = useState(true);
  const [showResources, setShowResources] = useState(true);
  const [showLayers, setShowLayers] = useState(true);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("");
  const selectedParams = new URLSearchParams(window.location.search);
  const selectedType = selectedParams.get("type");
  const selectedId = selectedParams.get("id");
  const selectedFeature = features.find((feature) => feature.type === selectedType && feature.id === selectedId) ?? null;

  useEffect(() => {
    void api.mapFeatures().then((result) => {
      if (result.data) setFeatures(result.data.features);
      setLoaded(true);
    });
  }, []);

  const search = query.trim().toLowerCase();
  const categories = Array.from(new Set(features.map((feature) => feature.category))).sort();
  const statuses = Array.from(new Set(features.map((feature) => feature.status))).sort();
  const filtered = features.filter((feature) => {
    const layerVisible = feature.type === "report" ? showReports : feature.type === "resource" ? showResources : showLayers;
    const matchesQuery = !search || [feature.label, feature.category, feature.status, feature.locationLabel]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(search));
    const matchesCategory = !category || feature.category === category;
    const matchesStatus = !status || feature.status === status;
    return layerVisible && matchesQuery && matchesCategory && matchesStatus;
  });
  const disableMap = Boolean(config?.crisisMode.disableMaps);
  const moduleDisabled = config ? !moduleEnabled(config, "maps", false) : false;
  const reportCount = features.filter((feature) => feature.type === "report").length;
  const resourceCount = features.filter((feature) => feature.type === "resource").length;
  const layerCount = features.filter((feature) => feature.type === "layer").length;

  return (
    <main className="page-layout map-page">
      <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "Map" }]} onNavigate={onNavigate} />
      <div className="page-header">
        <div>
          <p className="eyebrow">Area overview</p>
          <h1>Map</h1>
        </div>
        <button className="secondary" onClick={() => onNavigate("/resources")}>{t(locale, "resources")}</button>
      </div>
      <section className="map-shell">
        <div className="map-toolbar">
          <div className="map-summary">
            <article><strong>{reportCount}</strong><span>mapped reports</span></article>
            <article><strong>{resourceCount}</strong><span>mapped resources</span></article>
            <article><strong>{layerCount}</strong><span>active layers</span></article>
          </div>
          <div className="map-layer-controls">
            <label className="checkbox-row">
              <input type="checkbox" checked={showReports} onChange={(event) => setShowReports(event.target.checked)} />
              Reports
            </label>
            <label className="checkbox-row">
              <input type="checkbox" checked={showResources} onChange={(event) => setShowResources(event.target.checked)} />
              Resources
            </label>
            <label className="checkbox-row">
              <input type="checkbox" checked={showLayers} onChange={(event) => setShowLayers(event.target.checked)} />
              Layers
            </label>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search map records" />
            <select value={category} onChange={(event) => setCategory(event.target.value)}>
              <option value="">All types</option>
              {categories.map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}
            </select>
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">Any status</option>
              {statuses.map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}
            </select>
          </div>
        </div>
        <div className="map-content-grid">
          <div className="map-frame-panel">
            {!loaded ? (
              <div className="map-empty-state">
                <MapPin aria-hidden="true" />
                <h2>Loading mapped records</h2>
                <p>Fetching public reports and resources with safe map coordinates.</p>
              </div>
            ) : !moduleDisabled && !disableMap && filtered.length ? (
              <LeafletMap features={filtered} config={config} selectedFeatureId={selectedFeature?.id} onNavigate={onNavigate} />
            ) : (
              <div className="map-empty-state">
                <MapPin aria-hidden="true" />
                <h2>{moduleDisabled ? "Map module is disabled" : disableMap ? "Map hidden for crisis mode" : features.length ? "No records match these filters" : "No mapped records yet"}</h2>
                <p>
                  {moduleDisabled
                    ? "Enable Maps in Admin modules to show public map records."
                    : disableMap
                      ? "Use the list view while crisis mode disables map loading."
                      : features.length
                        ? "Clear search, type, or status filters to restore records."
                        : "Add coordinates to resources or reports in Admin to show markers here."}
                </p>
                <div className="button-row">
                  <button onClick={() => onNavigate("/admin")}>Open Admin</button>
                  <button className="secondary" onClick={() => onNavigate("/resources")}>View resources</button>
                </div>
              </div>
            )}
          </div>
          <aside className="map-list-panel">
            <div className="map-list-header">
              <h2>Mapped records</h2>
              {selectedFeature && <span className="badge success">Focused: {selectedFeature.label}</span>}
            </div>
            <div className="map-list">
              {filtered.map((feature) => (
                <article className={selectedFeature?.id === feature.id && selectedFeature.type === feature.type ? "card map-record selected" : "card map-record"} key={`${feature.type}-list-${feature.id}`}>
                  <div>
                    <div className="badge-row">
                      <span className={feature.type === "resource" ? "badge info" : "badge"}>{feature.type}</span>
                      <span className="badge muted">{verificationLabels[feature.verificationLevel]}</span>
                    </div>
                    <strong>{feature.label}</strong>
                    <p>{feature.category.replaceAll("_", " ")} · {feature.status.replaceAll("_", " ")} · {feature.precision}</p>
                    <small>{feature.locationLabel ?? featureCoordinatesLabel(feature)} · updated {new Date(feature.updatedAt).toLocaleDateString()}</small>
                  </div>
                  <div className="button-row">
                    <button className="secondary" onClick={() => onNavigate(`/map?type=${feature.type}&id=${feature.id}`)}>Focus</button>
                    <button className="secondary" onClick={() => onNavigate(feature.url)}>Open</button>
                  </div>
                </article>
              ))}
              {!filtered.length && <p className="empty">No records match the selected layers.</p>}
            </div>
          </aside>
        </div>
      </section>
    </main>
  );
}

function LeafletMap({
  features,
  config,
  selectedFeatureId,
  onNavigate
}: {
  features: MapFeature[];
  config: PublicConfig | null;
  selectedFeatureId?: string;
  onNavigate: (path: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let disposed = false;
    let map: LeafletMapInstance | null = null;
    setError("");

    void loadLeaflet().then((L) => {
      if (disposed || !containerRef.current) return;
      map = L.map(containerRef.current, { scrollWheelZoom: false }).setView([10.5, -66.9], 7);
      L.tileLayer(config?.map.tileUrl ?? "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: config?.map.attribution ?? "&copy; OpenStreetMap contributors",
        maxZoom: 19
      }).addTo(map);

      const pointFeatures = features.filter(hasFeaturePoint);
      const bounds = L.latLngBounds(pointFeatures.map((feature) => [feature.lat, feature.lng]));
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [32, 32], maxZoom: 14 });
      const selectedFeature = pointFeatures.find((feature) => feature.id === selectedFeatureId);
      if (selectedFeature) map.setView([selectedFeature.lat, selectedFeature.lng], 14);

      for (const feature of pointFeatures) {
        const marker = L.marker([feature.lat, feature.lng], { title: feature.label }).addTo(map);
        marker.bindPopup?.(
          `<strong>${escapeHtml(feature.label)}</strong><br>${escapeHtml(feature.category.replaceAll("_", " "))} · ${escapeHtml(feature.status.replaceAll("_", " "))}<br>${escapeHtml(feature.locationLabel ?? feature.precision)}`
        );
        marker.on?.("click", () => onNavigate(feature.url));
      }
    }).catch(() => {
      if (!disposed) setError("Map tiles could not be loaded. Use the list below.");
    });

    return () => {
      disposed = true;
      map?.remove();
    };
  }, [config?.map.attribution, config?.map.tileUrl, features, onNavigate, selectedFeatureId]);

  return (
    <>
      <div className="leaflet-map" ref={containerRef} role="application" aria-label="Map of reports and resources" />
      {error && <p className="empty">{error}</p>}
    </>
  );
}

function hasFeaturePoint(feature: MapFeature): feature is MapFeature & { lat: number; lng: number } {
  return typeof feature.lat === "number" && typeof feature.lng === "number" && Number.isFinite(feature.lat) && Number.isFinite(feature.lng);
}

function featureCoordinatesLabel(feature: MapFeature): string {
  return hasFeaturePoint(feature) ? `${feature.lat.toFixed(4)}, ${feature.lng.toFixed(4)}` : "No representative point";
}

function CoordinatePickerMap({
  config,
  lat,
  lng,
  formId,
  latField,
  lngField
}: {
  config: PublicConfig | null;
  lat?: number | null;
  lng?: number | null;
  formId: string;
  latField: string;
  lngField: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [picked, setPicked] = useState<{ lat: number; lng: number } | null>(lat !== null && lat !== undefined && lng !== null && lng !== undefined ? { lat, lng } : null);
  const [error, setError] = useState("");

  useEffect(() => {
    let disposed = false;
    let map: LeafletMapInstance | null = null;
    let marker: LeafletLayer | null = null;
    setError("");

    void loadLeaflet().then((L) => {
      if (disposed || !containerRef.current) return;
      const initial: [number, number] = picked ? [picked.lat, picked.lng] : [10.5, -66.9];
      map = L.map(containerRef.current, { scrollWheelZoom: false }).setView(initial, picked ? 13 : 7);
      L.tileLayer(config?.map.tileUrl ?? "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: config?.map.attribution ?? "&copy; OpenStreetMap contributors",
        maxZoom: 19
      }).addTo(map);

      if (picked) marker = L.marker([picked.lat, picked.lng], { title: "Selected coordinates" }).addTo(map);
      map.on?.("click", (event) => {
        const next = {
          lat: Number(event.latlng.lat.toFixed(6)),
          lng: Number(event.latlng.lng.toFixed(6))
        };
        setPicked(next);
        setFormField(formId, latField, String(next.lat));
        setFormField(formId, lngField, String(next.lng));
        if (marker?.setLatLng) {
          marker.setLatLng([next.lat, next.lng]);
        } else {
          marker = L.marker([next.lat, next.lng], { title: "Selected coordinates" }).addTo(map!);
        }
      });
    }).catch(() => {
      if (!disposed) setError("Coordinate picker could not load map tiles. Enter coordinates manually.");
    });

    return () => {
      disposed = true;
      marker?.remove?.();
      map?.remove();
    };
  }, [config?.map.attribution, config?.map.tileUrl, formId, latField, lngField]);

  return (
    <div className="coordinate-picker">
      <div className="coordinate-picker-map" ref={containerRef} role="application" aria-label="Click map to set coordinates" />
      <p>{picked ? `Selected ${picked.lat}, ${picked.lng}` : "Click the map to set latitude and longitude."}</p>
      {error && <p className="empty">{error}</p>}
    </div>
  );
}

function VolunteerForm({ config, onNavigate }: { config: PublicConfig | null; onNavigate: (path: string) => void }) {
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await api.registerVolunteer(new FormData(event.currentTarget));
    setMessage(result.error ?? "Volunteer registration submitted for review.");
    if (result.data) event.currentTarget.reset();
  }

  return (
    <main className="page-layout form-page">
      <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "Volunteer" }]} onNavigate={onNavigate} />
      <div className="page-header">
        <div>
          <p className="eyebrow">Volunteer registry</p>
          <h1>Offer help</h1>
        </div>
      </div>
      <form className="card stacked-form emergency-form" onSubmit={submit}>
        <label>
          Name
          <input name="name" required />
        </label>
        <label>
          Contact
          <input name="contact" required />
        </label>
        <label>
          Location
          <input name="location" />
        </label>
        <label>
          Availability
          <input name="availability" />
        </label>
        <label className="full-span">
          Skills
          <textarea name="skills" />
        </label>
        <label>
          Languages
          <input name="languages" />
        </label>
        <label>
          Transport access
          <input name="transportAccess" />
        </label>
        <label className="full-span">
          Credentials or notes for verified organizations
          <textarea name="credentials" />
        </label>
        <label className="checkbox-row full-span">
          <input name="consentShare" type="checkbox" value="yes" required />
          I consent to share this volunteer information with admins and verified organizations.
        </label>
        {config?.turnstileSiteKey && <div className="cf-turnstile" data-sitekey={config.turnstileSiteKey} data-action="volunteer"></div>}
        <button className="full-span" type="submit">Submit volunteer registration</button>
        {message && <p className="form-message full-span">{message}</p>}
      </form>
    </main>
  );
}

function DataRequestForm({ config, onNavigate }: { config: PublicConfig | null; onNavigate: (path: string) => void }) {
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await api.submitDataRequest(new FormData(event.currentTarget));
    setMessage(result.error ?? "Privacy request submitted.");
    if (result.data) event.currentTarget.reset();
  }

  return (
    <main className="page-layout form-page">
      <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "Privacy request" }]} onNavigate={onNavigate} />
      <div className="page-header">
        <div>
          <p className="eyebrow">Privacy and data rights</p>
          <h1>Request export, correction, or removal</h1>
        </div>
      </div>
      <form className="card stacked-form" onSubmit={submit}>
        <label>
          Request type
          <select name="type" required>
            <option value="export">Export my data</option>
            <option value="rectification">Correct information</option>
            <option value="erasure">Remove information</option>
            <option value="takedown">Takedown unsafe public content</option>
          </select>
        </label>
        <label>
          Report ID, optional
          <input name="reportId" />
        </label>
        <label>
          Contact
          <input name="requesterContact" required />
        </label>
        <label>
          Details
          <textarea name="details" />
        </label>
        {config?.turnstileSiteKey && <div className="cf-turnstile" data-sitekey={config.turnstileSiteKey} data-action="data_request"></div>}
        <button type="submit">Submit request</button>
        {message && <p className="form-message">{message}</p>}
      </form>
    </main>
  );
}

function Admin({
  config,
  initialTab,
  onConfigRefresh,
  onNavigate
}: {
  config: PublicConfig | null;
  initialTab: string;
  onConfigRefresh: () => Promise<unknown>;
  onNavigate: (path: string) => void;
}) {
  const [email, setEmail] = useState(localStorage.getItem("emergos-admin-email") ?? "");
  const [tab, setTab] = useState(initialTab);
  const [metrics, setMetrics] = useState<Record<string, number> | null>(null);
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);
  const [workQueue, setWorkQueue] = useState<Array<Record<string, unknown>>>([]);
  const [mediaReview, setMediaReview] = useState<MediaReviewItem[]>([]);
  const [apiClients, setApiClients] = useState<PartnerApiClient[]>([]);
  const [newApiToken, setNewApiToken] = useState("");
  const [reports, setReports] = useState<PublicReport[]>([]);
  const [resources, setResources] = useState<PublicResource[]>([]);
  const [contacts, setContacts] = useState<EmergencyContact[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [tips, setTips] = useState<Array<Record<string, unknown>>>([]);
  const [logs, setLogs] = useState<Array<Record<string, unknown>>>([]);
  const [duplicates, setDuplicates] = useState<DuplicateCandidate[]>([]);
  const [imports, setImports] = useState<ImportJob[]>([]);
  const [exportsList, setExportsList] = useState<ExportJob[]>([]);
  const [organizations, setOrganizations] = useState<PublicOrganization[]>([]);
  const [volunteers, setVolunteers] = useState<VolunteerRegistration[]>([]);
  const [updates, setUpdates] = useState<PublicUpdate[]>([]);
  const [dataRequests, setDataRequests] = useState<DataRequest[]>([]);
  const [generatedFiles, setGeneratedFiles] = useState<GeneratedFile[]>([]);
  const [inboundEmails, setInboundEmails] = useState<InboundEmailTip[]>([]);
  const [retentionPolicy, setRetentionPolicy] = useState<RetentionPolicy | null>(null);
  const [memberships, setMemberships] = useState<OrganizationMembership[]>([]);
  const [organizationApplications, setOrganizationApplications] = useState<OrganizationApplication[]>([]);
  const [volunteerAssignments, setVolunteerAssignments] = useState<VolunteerAssignment[]>([]);
  const [notifications, setNotifications] = useState<NotificationEvent[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowRun[]>([]);
  const [geodataImports, setGeodataImports] = useState<GeodataImport[]>([]);
  const [mapLayers, setMapLayers] = useState<MapLayer[]>([]);
  const [resourceTranslations, setResourceTranslations] = useState<ResourceTranslation[]>([]);
  const [localeOverrides, setLocaleOverrides] = useState<LocaleOverride[]>([]);
  const [aiSuggestions, setAiSuggestions] = useState<AiSuggestion[]>([]);
  const [health, setHealth] = useState<HealthMetrics | null>(null);
  const [retentionPreview, setRetentionPreview] = useState<Record<string, number> | null>(null);
  const [message, setMessage] = useState("");
  const [editingResource, setEditingResource] = useState<PublicResource | null>(null);
  const [editingReport, setEditingReport] = useState<PublicReport | null>(null);
  const [resourceSearch, setResourceSearch] = useState("");
  const [resourceTypeFilter, setResourceTypeFilter] = useState("");
  const [resourceStatusFilter, setResourceStatusFilter] = useState("");
  const [resourceMapFilter, setResourceMapFilter] = useState("");

  function openAdminTab(nextTab: string) {
    setTab(nextTab);
    onNavigate(adminTabPath(nextTab));
  }

  async function load() {
    localStorage.setItem("emergos-admin-email", email);
    const [
      dashboard,
      workQueueResult,
      moderation,
      mediaReviewResult,
      adminReports,
      adminResources,
      adminContacts,
      adminUsers,
      adminTips,
      auditLogs,
      duplicateResult,
      importResult,
      exportResult,
      organizationResult,
      volunteerResult,
      updateResult,
      dataRequestResult,
      generatedFileResult,
      inboundEmailResult,
      retentionPolicyResult,
      membershipResult,
      organizationApplicationResult,
      volunteerAssignmentResult,
      notificationResult,
      workflowResult,
      geodataResult,
      mapLayerResult,
      resourceTranslationResult,
      localeOverrideResult,
      aiResult,
      healthResult,
      apiClientResult
    ] = await Promise.all([
      api.dashboard(email),
      api.workQueue(email),
      api.moderation(email),
      api.mediaReview(email),
      api.adminReports(email),
      api.adminResources(email),
      api.adminContacts(email),
      api.adminUsers(email),
      api.adminTips(email),
      api.auditLogs(email),
      api.duplicates(email),
      api.imports(email),
      api.exports(email),
      api.adminOrganizations(email),
      api.adminVolunteers(email),
      api.updates(),
      api.dataRequests(email),
      api.generatedFiles(email),
      api.inboundEmails(email),
      api.retentionPolicy(email),
      api.organizationMemberships(email),
      api.organizationApplications(email),
      api.volunteerAssignments(email),
      api.notifications(email),
      api.workflows(email),
      api.geodataImports(email),
      api.mapLayers(email),
      api.resourceTranslations(email),
      api.localeOverrides(email),
      api.aiSuggestions(email),
      api.health(email),
      api.apiClients(email)
    ]);
    if (dashboard.data) setMetrics(dashboard.data.metrics);
    if (workQueueResult.data) setWorkQueue(workQueueResult.data.items as Array<Record<string, unknown>>);
    if (moderation.data) setItems(moderation.data.items as Array<Record<string, unknown>>);
    if (mediaReviewResult.data) setMediaReview(mediaReviewResult.data.media);
    if (adminReports.data) setReports(adminReports.data.reports);
    if (adminResources.data) setResources(adminResources.data.resources);
    if (adminContacts.data) setContacts(adminContacts.data.contacts);
    if (adminUsers.data) setUsers(adminUsers.data.users);
    if (adminTips.data) setTips(adminTips.data.tips);
    if (auditLogs.data) setLogs(auditLogs.data.logs);
    if (duplicateResult.data) setDuplicates(duplicateResult.data.duplicates);
    if (importResult.data) setImports(importResult.data.imports);
    if (exportResult.data) setExportsList(exportResult.data.exports);
    if (organizationResult.data) setOrganizations(organizationResult.data.organizations);
    if (volunteerResult.data) setVolunteers(volunteerResult.data.volunteers);
    if (updateResult.data) setUpdates(updateResult.data.updates);
    if (dataRequestResult.data) setDataRequests(dataRequestResult.data.dataRequests);
    if (generatedFileResult.data) setGeneratedFiles(generatedFileResult.data.files);
    if (inboundEmailResult.data) setInboundEmails(inboundEmailResult.data.emails);
    if (retentionPolicyResult.data) setRetentionPolicy(retentionPolicyResult.data.policy);
    if (membershipResult.data) setMemberships(membershipResult.data.memberships);
    if (organizationApplicationResult.data) setOrganizationApplications(organizationApplicationResult.data.applications);
    if (volunteerAssignmentResult.data) setVolunteerAssignments(volunteerAssignmentResult.data.assignments);
    if (notificationResult.data) setNotifications(notificationResult.data.notifications);
    if (workflowResult.data) setWorkflows(workflowResult.data.workflows);
    if (geodataResult.data) setGeodataImports(geodataResult.data.imports);
    if (mapLayerResult.data) setMapLayers(mapLayerResult.data.layers);
    if (resourceTranslationResult.data) setResourceTranslations(resourceTranslationResult.data.translations);
    if (localeOverrideResult.data) setLocaleOverrides(localeOverrideResult.data.overrides);
    if (aiResult.data) setAiSuggestions(aiResult.data.suggestions);
    if (healthResult.data) setHealth(healthResult.data.metrics);
    if (apiClientResult.data) setApiClients(apiClientResult.data.clients);
    setMessage(
      dashboard.error ?? workQueueResult.error ?? moderation.error ?? mediaReviewResult.error ?? adminReports.error ?? adminResources.error ?? adminContacts.error ?? adminUsers.error ??
      adminTips.error ?? auditLogs.error ?? duplicateResult.error ?? importResult.error ?? exportResult.error ??
      organizationResult.error ?? volunteerResult.error ?? updateResult.error ?? dataRequestResult.error ??
      generatedFileResult.error ?? inboundEmailResult.error ?? retentionPolicyResult.error ?? membershipResult.error ??
      organizationApplicationResult.error ?? volunteerAssignmentResult.error ?? notificationResult.error ?? workflowResult.error ??
      geodataResult.error ?? mapLayerResult.error ?? resourceTranslationResult.error ?? localeOverrideResult.error ??
      aiResult.error ?? healthResult.error ?? apiClientResult.error ?? ""
    );
  }

  async function decide(itemId: string, action: "approve" | "reject") {
    const result = action === "approve" ? await api.approveModeration(email, itemId) : await api.rejectModeration(email, itemId);
    setMessage(result.error ?? "Updated.");
    await load();
  }

  async function moderationAction(itemId: string, action: string) {
    const reason = window.prompt(`Reason for ${action.replaceAll("_", " ")}`, "");
    const result = await api.moderationAction(email, itemId, { action, reason: reason ?? undefined, reviewerNote: reason ?? undefined });
    setMessage(result.error ?? "Moderation action saved.");
    await load();
  }

  async function updateReportStatus(reportId: string, status: string) {
    const result = await api.updateReport(email, reportId, { moderationStatus: status });
    setMessage(result.error ?? "Report updated.");
    await load();
  }

  async function saveReportDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const reportId = String(form.get("id") ?? "");
    const result = await api.updateReport(email, reportId, formObject(form));
    setMessage(result.error ?? "Report location saved.");
    if (result.data) setEditingReport(null);
    await load();
  }

  async function saveResource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = formObject(form);
    const id = String(form.get("id") ?? "");
    const result = id ? await api.updateResource(email, id, body) : await api.createResource(email, body);
    setMessage(result.error ?? "Resource saved.");
    if (result.data) {
      event.currentTarget.reset();
      setEditingResource(null);
    }
    await load();
  }

  async function markResourceVerified(resource: PublicResource) {
    const result = await api.markResourceVerified(email, resource.id, resource.verificationLevel);
    setMessage(result.error ?? "Resource verification refreshed.");
    await load();
  }

  async function updateResourceAvailability(resource: PublicResource, availabilityStatus: string) {
    const result = await api.updateResource(email, resource.id, { availabilityStatus });
    setMessage(result.error ?? "Resource status updated.");
    await load();
  }

  async function bulkUpdateFilteredResources(body: Record<string, unknown>, successMessage: string) {
    const results = await Promise.all(filteredAdminResources.map((resource) => api.updateResource(email, resource.id, body)));
    const error = results.find((result) => result.error)?.error;
    setMessage(error ?? `${successMessage} (${filteredAdminResources.length} resources).`);
    await load();
  }

  async function copyPublicUrl(path: string) {
    const url = `${window.location.origin}${path}`;
    try {
      await navigator.clipboard?.writeText(url);
      setMessage(`Copied ${url}`);
    } catch {
      setMessage(url);
    }
  }

  async function saveContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = formObject(form);
    const id = String(form.get("id") ?? "");
    const result = id ? await api.updateContact(email, id, body) : await api.createContact(email, body);
    setMessage(result.error ?? "Emergency contact saved.");
    if (result.data) event.currentTarget.reset();
    await load();
  }

  async function saveUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await api.createUser(email, formObject(form));
    setMessage(result.error ?? "User saved.");
    if (result.data) event.currentTarget.reset();
    await load();
  }

  async function changeUserRole(userId: string, role: string) {
    const result = await api.updateUserRole(email, userId, role);
    setMessage(result.error ?? "Role updated.");
    await load();
  }

  async function mergeDuplicate(reportId: string, canonicalReportId: string) {
    const result = await api.mergeReport(email, reportId, canonicalReportId);
    setMessage(result.error ?? "Reports merged.");
    await load();
  }

  async function requestDuplicateCheck(reportId: string) {
    const result = await api.requestDuplicateCheck(email, reportId);
    setMessage(result.error ?? "Duplicate check queued.");
    await load();
  }

  async function saveImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await api.createImport(email, new FormData(event.currentTarget));
    setMessage(result.error ?? "Import queued.");
    if (result.data) event.currentTarget.reset();
    await load();
  }

  async function saveExport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await api.createExport(email, formObject(new FormData(event.currentTarget)));
    setMessage(result.error ?? "Export queued.");
    if (result.data) event.currentTarget.reset();
    await load();
  }

  async function saveOrganization(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const id = String(form.get("id") ?? "");
    const body = formObject(form);
    const result = id ? await api.updateOrganization(email, id, body) : await api.createOrganization(email, body);
    setMessage(result.error ?? "Organization saved.");
    if (result.data) event.currentTarget.reset();
    await load();
  }

  async function saveUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const id = String(form.get("id") ?? "");
    const body = { ...formObject(form), pinned: form.get("pinned") === "yes" };
    const result = id ? await api.updateUpdate(email, id, body) : await api.createUpdate(email, body);
    setMessage(result.error ?? "Public update saved.");
    if (result.data) event.currentTarget.reset();
    await load();
  }

  async function updateVolunteer(volunteerId: string, status: string) {
    const result = await api.updateVolunteer(email, volunteerId, { status });
    setMessage(result.error ?? "Volunteer updated.");
    await load();
  }

  async function saveVolunteerAssignment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await api.createVolunteerAssignment(email, formObject(new FormData(event.currentTarget)));
    setMessage(result.error ?? "Volunteer assignment saved.");
    if (result.data) event.currentTarget.reset();
    await load();
  }

  async function updateVolunteerAssignment(assignmentId: string, status: string) {
    const result = await api.updateVolunteerAssignment(email, assignmentId, { status });
    setMessage(result.error ?? "Volunteer assignment updated.");
    await load();
  }

  async function approveOrganizationApplication(applicationId: string) {
    const result = await api.approveOrganizationApplication(email, applicationId);
    setMessage(result.error ?? "Organization application approved.");
    await load();
  }

  async function rejectOrganizationApplication(applicationId: string) {
    const reason = window.prompt("Reason for rejecting this organization application", "");
    const result = await api.rejectOrganizationApplication(email, applicationId, reason ?? undefined);
    setMessage(result.error ?? "Organization application rejected.");
    await load();
  }

  async function updateDataRequest(requestId: string, status: string) {
    const result = await api.updateDataRequest(email, requestId, { status });
    setMessage(result.error ?? "Data request updated.");
    await load();
  }

  async function generateDataRequestExport(requestId: string) {
    const result = await api.generateDataRequestExport(email, requestId);
    setMessage(result.error ?? "Data request export generated.");
    await load();
  }

  async function generateFile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = formObject(form);
    const entityRef = parseEntityRef(String(form.get("entityRef") ?? ""));
    if (entityRef) {
      body.entityType = entityRef.type;
      body.entityId = entityRef.id;
    }
    const result = await api.createGeneratedFile(email, body);
    setMessage(result.error ?? "File generated.");
    if (result.data) event.currentTarget.reset();
    await load();
  }

  async function assignOrganization(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const [entityType, entityId] = String(form.get("entityRef") ?? "").split(":");
    const organizationId = String(form.get("organizationId") ?? "");
    const result = entityType === "resource"
      ? await api.assignResourceOrganization(email, entityId, organizationId)
      : await api.assignReportOrganization(email, entityId, organizationId);
    setMessage(result.error ?? "Organization assigned.");
    if (result.data) event.currentTarget.reset();
    await load();
  }

  async function saveRetentionPolicy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await api.updateRetentionPolicy(email, {
      tipsDaysAfterClosure: Number(form.get("tipsDaysAfterClosure")),
      auditLogDays: Number(form.get("auditLogDays")),
      volunteerDaysAfterCrisis: Number(form.get("volunteerDaysAfterCrisis")),
      enabled: form.get("enabled") === "yes"
    });
    setMessage(result.error ?? "Retention policy saved.");
    await load();
  }

  async function saveCrisisMode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await api.updateCrisisMode(email, {
      enabled: form.get("enabled") === "yes",
      disableMaps: form.get("disableMaps") === "yes",
      preferLists: form.get("preferLists") === "yes",
      imageLight: form.get("imageLight") === "yes"
    });
    setMessage(result.error ?? "Crisis mode saved.");
    if (result.data) await onConfigRefresh();
    await load();
  }

  async function saveModules(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = Object.fromEntries(moduleKeys.map((key) => [key, form.get(key) === "yes"])) as Record<string, boolean>;
    const result = await api.updateModules(email, body);
    setMessage(result.error ?? "Modules saved.");
    if (result.data) await onConfigRefresh();
  }

  async function saveMembership(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await api.createOrganizationMembership(email, formObject(new FormData(event.currentTarget)));
    setMessage(result.error ?? "Organization membership saved.");
    if (result.data) event.currentTarget.reset();
    await load();
  }

  async function deleteMembership(id: string) {
    const result = await api.deleteOrganizationMembership(email, id);
    setMessage(result.error ?? "Organization membership removed.");
    await load();
  }

  async function sendTestNotification(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await api.createNotification(email, formObject(new FormData(event.currentTarget)));
    setMessage(result.error ?? "Notification queued.");
    if (result.data) event.currentTarget.reset();
    await load();
  }

  async function processNotification(notificationId: string) {
    const result = await api.processNotification(email, notificationId);
    setMessage(result.error ?? "Notification processed.");
    await load();
  }

  async function cancelNotification(notificationId: string) {
    const result = await api.cancelNotification(email, notificationId);
    setMessage(result.error ?? "Notification cancelled.");
    await load();
  }

  async function startWorkflow(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = formObject(form);
    const entityRef = parseEntityRef(String(form.get("entityRef") ?? ""));
    if (entityRef) {
      body.entityType = entityRef.type;
      body.entityId = entityRef.id;
    }
    const result = await api.createWorkflow(email, body);
    setMessage(result.error ?? "Workflow queued.");
    if (result.data) event.currentTarget.reset();
    await load();
  }

  async function saveGeodataImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await api.createGeodataImport(email, new FormData(event.currentTarget));
    setMessage(result.error ?? "Geodata import queued.");
    if (result.data) event.currentTarget.reset();
    await load();
  }

  async function saveMapLayer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const geometryText = String(form.get("geometry") ?? "");
    let geometry: Record<string, unknown>;
    try {
      geometry = JSON.parse(geometryText) as Record<string, unknown>;
    } catch {
      setMessage("Geometry must be valid GeoJSON geometry JSON.");
      return;
    }
    const result = await api.createMapLayer(email, { ...formObject(form), geometry });
    setMessage(result.error ?? "Map layer saved.");
    if (result.data) event.currentTarget.reset();
    await load();
  }

  async function saveResourceTranslation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await api.saveResourceTranslation(email, formObject(new FormData(event.currentTarget)));
    setMessage(result.error ?? "Resource translation saved.");
    if (result.data) event.currentTarget.reset();
    await load();
  }

  async function saveLocaleOverride(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await api.saveLocaleOverride(email, formObject(new FormData(event.currentTarget)));
    setMessage(result.error ?? "Locale override saved.");
    if (result.data) event.currentTarget.reset();
    await load();
  }

  async function requestAiSuggestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const kind = String(form.get("kind") ?? "moderation");
    const body = formObject(form);
    const entityRef = parseEntityRef(String(form.get("entityRef") ?? ""));
    if (entityRef) {
      body.entityType = entityRef.type;
      body.entityId = entityRef.id;
    }
    const result = kind === "translation"
      ? await api.createTranslationDraft(email, body)
      : await api.createAiSuggestion(email, body);
    setMessage(result.error ?? "Suggestion created.");
    if (result.data) event.currentTarget.reset();
    await load();
  }

  async function previewRetention() {
    const result = await api.retentionPreview(email);
    if (result.data) setRetentionPreview(result.data.preview);
    setMessage(result.error ?? "Retention preview refreshed.");
  }

  async function runRetention() {
    const result = await api.runRetention(email);
    if (result.data) setRetentionPreview(result.data.preview);
    setMessage(result.error ?? "Retention cleanup completed.");
    await load();
  }

  async function createPartnerApiClient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const scopes = Array.from(form.getAll("scopes")).map(String);
    const result = await api.createApiClient(email, { name: String(form.get("name") ?? ""), scopes });
    if (result.data) {
      setNewApiToken(result.data.token);
      event.currentTarget.reset();
    }
    setMessage(result.error ?? "Partner API client created. Copy the token now; it will not be shown again.");
    await load();
  }

  async function revokePartnerApiClient(clientId: string) {
    const result = await api.revokeApiClient(email, clientId);
    setMessage(result.error ?? "Partner API client revoked.");
    await load();
  }

  useEffect(() => {
    if (email) void load();
  }, []);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  const filteredAdminResources = resources.filter((resource) => {
    const search = resourceSearch.trim().toLowerCase();
    const matchesSearch = !search || [resource.name, resource.description, resource.address, resource.city, resource.admin1, resource.organizationId]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(search));
    const matchesType = !resourceTypeFilter || resource.type === resourceTypeFilter;
    const matchesStatus = !resourceStatusFilter || resource.availabilityStatus === resourceStatusFilter;
    const matchesMap = !resourceMapFilter
      || resourceMapFilter === resourceMapState(resource)
      || (resourceMapFilter === "stale" && isResourceStale(resource));
    return matchesSearch && matchesType && matchesStatus && matchesMap;
  });
  const mapHealth = [
    { label: "Mapped resources", value: metrics?.mappedResources ?? resources.filter((resource) => resourceMapState(resource) === "mapped").length },
    { label: "Unmapped resources", value: metrics?.unmappedResources ?? resources.filter((resource) => resourceMapState(resource) === "missing").length },
    { label: "Mapped reports", value: metrics?.mappedReports ?? reports.filter((report) => reportMapState(report) === "mapped").length },
    { label: "Unmapped reports", value: metrics?.unmappedReports ?? reports.filter((report) => reportMapState(report) === "missing").length },
    { label: "Hidden map records", value: metrics?.hiddenMapRecords ?? resources.filter((resource) => resourceMapState(resource) === "hidden").length + reports.filter((report) => reportMapState(report) === "hidden").length },
    { label: "Invalid coordinates", value: metrics?.invalidCoordinateRecords ?? 0 }
  ];
  const moduleOverview = moduleKeys.map((key) => ({
    key,
    label: moduleLabels[key],
    enabled: moduleEnabled(config, key, key !== "maps" && key !== "volunteers" && key !== "missingPets"),
    publicPath: modulePublicPath(key),
    count: moduleRecordCount(key, { reports, resources, contacts, updates, organizations, volunteers, dataRequests })
  }));
  const urgentAdminActions = [
    { label: "Open moderation items", value: items.length, tab: "moderation", tone: items.length ? "warning" : "success" },
    { label: "Privacy requests", value: dataRequests.filter((request) => request.status !== "complete").length, tab: "privacy", tone: "info" },
    { label: "Unmapped resources", value: mapHealth.find((item) => item.label === "Unmapped resources")?.value ?? 0, tab: "resources", tone: "warning" },
    { label: "Stale resources", value: resources.filter(isResourceStale).length, tab: "resources", tone: "warning" },
    { label: "Duplicate candidates", value: duplicates.length, tab: "duplicates", tone: "info" },
    { label: "Failed imports", value: imports.filter((job) => job.status === "failed").length + geodataImports.filter((job) => job.status === "failed").length, tab: "imports", tone: "warning" }
  ];
  const adminQuickLinks = [
    { label: "Review queue", tab: "moderation", detail: "Approve, reject, or inspect public submissions." },
    { label: "Fix map coverage", tab: "resources", detail: "Add coordinates and verify resource status." },
    { label: "Publish update", tab: "updates", detail: "Post pinned guidance for the public site." },
    { label: "Invite operator", tab: "users", detail: "Create roles for moderators and partners." }
  ];

  return (
    <main className="page-layout">
      <Breadcrumbs items={[{ label: "Home", href: "/" }, { label: "Admin" }]} onNavigate={onNavigate} />
      <div className="page-header">
        <div>
          <p className="eyebrow">Moderation</p>
          <h1>Admin dashboard</h1>
        </div>
        <button onClick={() => void load()}>Refresh</button>
      </div>
      <section className="card stacked-form">
        <label>
          Local admin email fallback
          <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="owner@example.org" />
        </label>
        <p>Cloudflare Access headers are used in production. This field only helps local development.</p>
      </section>
      {message && <p className="form-message error">{message}</p>}
      <section className="admin-console">
        <aside className="admin-sidebar" aria-label="Admin sections">
          <div className="admin-sidebar-summary">
            <strong>{config?.brand.name ?? "emergOS"}</strong>
            <span>{config?.disaster.affectedAreaLabel ?? "Crisis response"}</span>
          </div>
          {adminNavigation.map((group) => (
            <div className="admin-nav-group" key={group.group}>
              <span>{group.group}</span>
              {group.items.map((value) => (
                <button className={tab === value ? "active" : ""} key={value} onClick={() => openAdminTab(value)}>
                  {adminTabLabels[value]}
                </button>
              ))}
            </div>
          ))}
        </aside>
        <div className="admin-workspace">

      {tab === "overview" && (
        <section className="admin-command-center">
          <div className="admin-command-hero">
            <div>
              <p className="eyebrow">Command center</p>
              <h2>Operate the response from one queue.</h2>
              <p>Prioritize unsafe content, map coverage, partner data, and public updates before deep system work.</p>
            </div>
            <button onClick={() => void load()}>Refresh all data</button>
          </div>
          <section className="metric-grid compact-metrics">
            {metrics && Object.entries(metrics).slice(0, 8).map(([key, value]) => (
              <article className="metric" key={key}>
                <span>{key.replace(/([A-Z])/g, " $1")}</span>
                <strong>{value}</strong>
              </article>
            ))}
          </section>
          <div className="admin-overview-grid">
            <section className="card admin-action-panel">
              <div className="form-card-header compact">
                <div>
                  <p className="eyebrow">Needs attention</p>
                  <h3>Operational queue</h3>
                </div>
              </div>
              {urgentAdminActions.map((action) => (
                <button className="admin-action-row" key={action.label} onClick={() => openAdminTab(action.tab)}>
                  <span>
                    <strong>{action.label}</strong>
                    <small>{action.value ? "Open work remains" : "Clear"}</small>
                  </span>
                  <span className={`badge ${action.tone}`}>{action.value}</span>
                </button>
              ))}
            </section>
            <section className="card admin-action-panel">
              <div className="form-card-header compact">
                <div>
                  <p className="eyebrow">Fast paths</p>
                  <h3>Common workflows</h3>
                </div>
              </div>
              {adminQuickLinks.map((link) => (
                <button className="admin-action-row" key={link.label} onClick={() => openAdminTab(link.tab)}>
                  <span>
                    <strong>{link.label}</strong>
                    <small>{link.detail}</small>
                  </span>
                </button>
              ))}
            </section>
            <section className="card admin-health-panel">
              <div className="form-card-header compact">
                <div>
                  <p className="eyebrow">Map readiness</p>
                  <h3>Public map health</h3>
                </div>
                <button className="secondary" onClick={() => onNavigate("/map")}>Open map</button>
              </div>
              <div className="metric-grid compact-metrics">
                {mapHealth.map((item) => (
                  <article className="metric" key={item.label}>
                    <span>{item.label}</span>
                    <strong>{item.value}</strong>
                  </article>
                ))}
              </div>
            </section>
          </div>
        </section>
      )}

      {tab === "health" && (
        <section className="admin-table-section">
          <h2>Health</h2>
          <section className="metric-grid">
            {health && Object.entries(health).map(([key, value]) => (
              <article className="metric" key={key}>
                <span>{key.replace(/([A-Z])/g, " $1")}</span>
                <strong>{value}</strong>
              </article>
            ))}
          </section>
          {!health && <p className="empty">Health metrics are not loaded.</p>}
        </section>
      )}

      {tab === "modules" && (
        <section className="admin-table-section">
          <h2>Modules</h2>
          <form className="card stacked-form admin-form" key={JSON.stringify(config?.modules ?? {})} onSubmit={saveModules}>
            <div className="module-grid">
              {moduleOverview.map((module) => (
                <label className={module.enabled ? "module-toggle enabled" : "module-toggle"} key={module.key}>
                  <span className="checkbox-row">
                    <input name={module.key} type="checkbox" value="yes" defaultChecked={module.enabled} />
                    <strong>{module.label}</strong>
                  </span>
                  <span>{moduleDescription(module.key)}</span>
                  <small>{module.count} records visible to admins</small>
                  {module.publicPath && <button className="inline-link" type="button" onClick={() => onNavigate(module.publicPath ?? "/")}>Open public view</button>}
                </label>
              ))}
            </div>
            <button type="submit">Save modules</button>
          </form>
        </section>
      )}

      {tab === "queue" && (
        <section className="admin-table-section">
          <div className="section-header">
            <div>
              <p className="eyebrow">Triage workflow</p>
              <h2>Work queue</h2>
            </div>
            <button className="secondary" onClick={() => void load()}><ClipboardList aria-hidden="true" /> Refresh</button>
          </div>
          <div className="work-queue-grid">
            {workQueue.map((item) => (
              <article className="card work-queue-item" key={String(item.id)}>
                <div className="moderation-card-header">
                  <div>
                    <div className="badge-row">
                      <span className="badge warning">{String(item.reason ?? "review").replaceAll("_", " ")}</span>
                      <span className="badge muted">{String(item.entity_type ?? "item")}</span>
                    </div>
                    <h3>{moderationTitle(item)}</h3>
                    <p>{String(item.report_display_name ?? item.change_type ?? item.alt_text ?? item.abuse_reason ?? "Needs operator review")}</p>
                  </div>
                  <small>{String(item.created_at ?? item.tip_created_at ?? "")}</small>
                </div>
                {Boolean(item.tip_body || item.contact_body || item.abuse_details || item.change_new_json || item.review_note) && (
                  <blockquote className="tip-body">
                    {String(item.tip_body ?? item.contact_body ?? item.abuse_details ?? item.change_new_json ?? item.review_note)}
                  </blockquote>
                )}
                <dl className="moderation-meta">
                  <div><dt>Contact</dt><dd>{formatPrivateContact(item.tipper_contact_private ?? item.contact_sender_contact_private ?? item.abuse_requester_contact_private)}</dd></div>
                  <div><dt>Status</dt><dd>{String(item.report_status ?? item.moderation_status ?? "pending").replaceAll("_", " ")}</dd></div>
                  <div><dt>Area</dt><dd>{[item.report_last_seen_city, item.report_last_seen_admin1].filter(Boolean).join(", ") || "Not provided"}</dd></div>
                  <div><dt>Queue</dt><dd>{String(item.entity_type ?? "moderation").replaceAll("_", " ")}</dd></div>
                </dl>
                <div className="button-row">
                  {Boolean(item.report_public_slug) && <button className="secondary" onClick={() => onNavigate(`/reports/${String(item.report_public_slug)}`)}>Open case</button>}
                  <button onClick={() => void decide(String(item.id), "approve")}><BadgeCheck aria-hidden="true" /> Approve</button>
                  <button className="secondary" onClick={() => void moderationAction(String(item.id), "request_info")}>Request info</button>
                  <button className="secondary" onClick={() => void moderationAction(String(item.id), "escalate")}>Escalate</button>
                  <button className="secondary" onClick={() => void decide(String(item.id), "reject")}><ShieldCheck aria-hidden="true" /> Reject</button>
                </div>
              </article>
            ))}
            {!workQueue.length && <p className="empty">No open work items.</p>}
          </div>
        </section>
      )}

      {tab === "media" && (
        <section className="admin-table-section">
          <div className="section-header">
            <div>
              <p className="eyebrow">Image safety</p>
              <h2>Media review</h2>
            </div>
            <button className="secondary" onClick={() => openAdminTab("queue")}>Open queue</button>
          </div>
          <div className="media-review-grid">
            {mediaReview.map((media) => (
              <article className="card media-review-item" key={media.id}>
                <div className="media-thumb">
                  {media.mimeType.startsWith("image/") ? <img src={`/media/${media.id}`} alt={media.altText ?? "Uploaded media"} /> : <ImageIcon aria-hidden="true" />}
                </div>
                <div>
                  <div className="badge-row">
                    <span className="badge muted">{media.type}</span>
                    <span className={media.moderationStatus === "published" ? "badge success" : "badge warning"}>{media.moderationStatus.replaceAll("_", " ")}</span>
                  </div>
                  <h3>{media.altText ?? "Uploaded media"}</h3>
                  <p>{media.riskFlags.length ? media.riskFlags.join(", ") : "No risk flags recorded"}</p>
                  <small>{new Date(media.createdAt).toLocaleString()}</small>
                </div>
              </article>
            ))}
            {!mediaReview.length && <p className="empty">No media needs review.</p>}
          </div>
        </section>
      )}

      {tab === "moderation" && (
        <section>
          <h2>Moderation queue</h2>
          <div className="moderation-list">
            {items.map((item) => (
              <article className="card moderation-card" key={String(item.id)}>
                <div className="moderation-card-header">
                  <div>
                    <div className="badge-row">
                      <span className="badge warning"><AlertTriangle aria-hidden="true" /> {String(item.reason).replace("_", " ")}</span>
                      <span className="badge muted">{String(item.entity_type)}</span>
                    </div>
                    <h3>{moderationTitle(item)}</h3>
                    <p>{String(item.report_display_name ?? item.abuse_reason ?? "Unassigned item")} {item.report_public_slug ? <button className="inline-link" onClick={() => onNavigate(`/reports/${String(item.report_public_slug)}`)}>View report</button> : null}</p>
                  </div>
                  <small>{String(item.tip_created_at ?? item.created_at ?? "")}</small>
                </div>

                {Boolean(item.tip_body || item.contact_body || item.abuse_details) && (
                  <blockquote className="tip-body">
                    {String(item.tip_body ?? item.contact_body ?? item.abuse_details)}
                  </blockquote>
                )}

                <dl className="moderation-meta">
                  <div><dt>Contact</dt><dd>{formatPrivateContact(item.tipper_contact_private ?? item.contact_sender_contact_private ?? item.abuse_requester_contact_private)}</dd></div>
                  <div><dt>Case status</dt><dd>{String(item.report_status ?? "Unknown").replaceAll("_", " ")}</dd></div>
                  <div><dt>Area</dt><dd>{[item.report_last_seen_city, item.report_last_seen_admin1].filter(Boolean).join(", ") || "Not provided"}</dd></div>
                  <div><dt>Reason</dt><dd>{String(item.abuse_reason ?? item.reason ?? "Review")}</dd></div>
                </dl>

                <div className="button-row">
                  <button onClick={() => void decide(String(item.id), "approve")}><BadgeCheck aria-hidden="true" /> Approve</button>
                  <button className="secondary" onClick={() => void decide(String(item.id), "reject")}><ShieldCheck aria-hidden="true" /> Reject</button>
                  <button className="secondary" onClick={() => void moderationAction(String(item.id), "request_info")}>Request info</button>
                  <button className="secondary" onClick={() => void moderationAction(String(item.id), "escalate")}>Escalate</button>
                  <button className="secondary" onClick={() => void moderationAction(String(item.id), "hide")}>Hide</button>
                  <button className="secondary" onClick={() => void moderationAction(String(item.id), "remove")}>Remove</button>
                </div>
              </article>
            ))}
            {!items.length && <p className="empty">No open moderation items.</p>}
          </div>
        </section>
      )}

      {tab === "reports" && (
        <section className="admin-table-section">
          <h2>Reports</h2>
          {editingReport && (
            <section className="card report-map-editor">
              <div className="form-card-header">
                <div>
                  <p className="eyebrow">Report map data</p>
                  <h2>{editingReport.displayName}</h2>
                </div>
                <span className={reportMapState(editingReport) === "mapped" ? "badge success" : reportMapState(editingReport) === "hidden" ? "badge warning" : "badge muted"}>
                  {reportMapState(editingReport) === "mapped" ? "Mapped" : reportMapState(editingReport) === "hidden" ? "Hidden from map" : "No coordinates"}
                </span>
              </div>
              {reportHasCoordinates(editingReport) && editingReport.locationPrecision !== "hidden" ? (
                <div className="resource-map-preview admin-preview">
                  <LeafletMap features={[reportToMapFeature(editingReport)]} config={config} selectedFeatureId={editingReport.id} onNavigate={() => undefined} />
                </div>
              ) : (
                <p className="map-hint">
                  {editingReport.locationPrecision === "hidden"
                    ? "This report has map visibility set to hidden."
                    : "Add latitude and longitude to show this report on the public map."}
                </p>
              )}
              <CoordinatePickerMap
                key={`report-picker-${editingReport.id}`}
                config={config}
                lat={editingReport.lastSeenLat}
                lng={editingReport.lastSeenLng}
                formId="admin-report-map-form"
                latField="lastSeenLat"
                lngField="lastSeenLng"
              />
              <form id="admin-report-map-form" className="stacked-form admin-form" key={editingReport.id} onSubmit={saveReportDetails}>
                <input name="id" type="hidden" defaultValue={editingReport.id} />
                <label>
                  Last seen area
                  <input name="lastSeenText" defaultValue={editingReport.lastSeenText ?? ""} />
                </label>
                <label>
                  City
                  <input name="lastSeenCity" defaultValue={editingReport.lastSeenCity ?? ""} />
                </label>
                <label>
                  State or region
                  <input name="lastSeenAdmin1" defaultValue={editingReport.lastSeenAdmin1 ?? ""} />
                </label>
                <label>
                  Latitude
                  <input name="lastSeenLat" inputMode="decimal" defaultValue={editingReport.lastSeenLat ?? ""} />
                </label>
                <label>
                  Longitude
                  <input name="lastSeenLng" inputMode="decimal" defaultValue={editingReport.lastSeenLng ?? ""} />
                </label>
                <label>
                  Location precision
                  <select name="locationPrecision" defaultValue={editingReport.locationPrecision}>
                    <option value="exact">Exact</option>
                    <option value="area">Area</option>
                    <option value="city">City only</option>
                    <option value="hidden">Hide from map</option>
                  </select>
                </label>
                <div className="button-row">
                  <button type="submit">Save report map data</button>
                  {reportMapState(editingReport) === "mapped" && <button className="secondary" type="button" onClick={() => onNavigate(`/map?type=report&id=${editingReport.id}`)}>Open public map</button>}
                  <button className="secondary" type="button" onClick={() => setEditingReport(null)}>Cancel</button>
                </div>
              </form>
            </section>
          )}
          <div className="admin-table">
            {reports.map((report) => (
              <article className="card admin-row" key={report.id}>
                <div>
                  <strong>{report.displayName}</strong>
                  <p>{report.type.replaceAll("_", " ")} · {statusLabels[report.status]} · {report.moderationStatus}</p>
                  <small>{reportMapState(report) === "mapped" ? `${report.lastSeenLat}, ${report.lastSeenLng}` : reportMapState(report) === "hidden" ? "Hidden from map" : "No map coordinates"}</small>
                </div>
                <div className="button-row">
                  <button className="secondary" onClick={() => onNavigate(`/reports/${report.publicSlug}`)}>Open</button>
                  <button className="secondary" onClick={() => void copyPublicUrl(`/reports/${report.publicSlug}`)}>Copy URL</button>
                  {reportMapState(report) === "mapped" && <button className="secondary" onClick={() => onNavigate(`/map?type=report&id=${report.id}`)}>Map</button>}
                  <button className="secondary" onClick={() => setEditingReport(report)}>Edit map</button>
                  <button className="secondary" onClick={() => void requestDuplicateCheck(report.id)}>Check duplicates</button>
                  <button onClick={() => void updateReportStatus(report.id, "published")}>Publish</button>
                  <button className="secondary" onClick={() => void updateReportStatus(report.id, "hidden")}>Hide</button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {tab === "duplicates" && (
        <section className="admin-table-section">
          <h2>Duplicate candidates</h2>
          <div className="admin-table">
            {duplicates.map((candidate) => (
              <article className="card admin-row" key={candidate.id}>
                <div>
                  <strong>{candidate.reportName ?? candidate.reportId}</strong>
                  <p>Candidate: {candidate.candidateName ?? candidate.candidateReportId} · Score {candidate.score}</p>
                  <small>{candidate.reasons.join(", ") || "No reasons recorded"}</small>
                </div>
                <div className="button-row">
                  <button onClick={() => void mergeDuplicate(candidate.reportId, candidate.candidateReportId)}>Merge into candidate</button>
                  <button className="secondary" onClick={() => void mergeDuplicate(candidate.candidateReportId, candidate.reportId)}>Merge candidate into report</button>
                </div>
              </article>
            ))}
            {!duplicates.length && <p className="empty">No open duplicate candidates.</p>}
          </div>
        </section>
      )}

      {tab === "resources" && (
        <section className="admin-table-section resource-manager">
          <div className="section-header">
            <div>
              <p className="eyebrow">Operations directory</p>
              <h2>Resources</h2>
            </div>
            <button onClick={() => setEditingResource(null)}>Create resource</button>
          </div>
          <div className="resource-manager-grid">
            <section className="card resource-manager-list">
              <div className="filters resource-admin-filters">
                <input value={resourceSearch} onChange={(event) => setResourceSearch(event.target.value)} placeholder="Search resources" />
                <select value={resourceTypeFilter} onChange={(event) => setResourceTypeFilter(event.target.value)}>
                  <option value="">All types</option>
                  {resourceTypes.map((type) => <option value={type} key={type}>{resourceTypeLabels[type]}</option>)}
                </select>
                <select value={resourceStatusFilter} onChange={(event) => setResourceStatusFilter(event.target.value)}>
                  <option value="">Any status</option>
                  <option value="open">Open</option>
                  <option value="full">Full</option>
                  <option value="closed">Closed</option>
                  <option value="unknown">Unknown</option>
                </select>
                <select value={resourceMapFilter} onChange={(event) => setResourceMapFilter(event.target.value)}>
                  <option value="">Any map state</option>
                  <option value="mapped">Mapped</option>
                  <option value="missing">Unmapped</option>
                  <option value="hidden">Hidden from map</option>
                  <option value="stale">Needs verification</option>
                </select>
              </div>
              <div className="bulk-action-bar">
                <strong>{filteredAdminResources.length} filtered</strong>
                <button className="secondary" type="button" onClick={() => void bulkUpdateFilteredResources({ availabilityStatus: "open" }, "Set filtered resources open")}>Set open</button>
                <button className="secondary" type="button" onClick={() => void bulkUpdateFilteredResources({ availabilityStatus: "closed" }, "Set filtered resources closed")}>Set closed</button>
                <button className="secondary" type="button" onClick={() => void bulkUpdateFilteredResources({ verificationLevel: "contact_verified" }, "Marked filtered resources verified")}>Mark verified</button>
              </div>
              <div className="resource-admin-list">
                {filteredAdminResources.map((resource) => (
                  <article className={editingResource?.id === resource.id ? "resource-admin-row active" : "resource-admin-row"} key={resource.id}>
                    <button type="button" onClick={() => setEditingResource(resource)}>
                      <span>
                        <strong>{resource.name}</strong>
                        <small>{resourceTypeLabels[resource.type]} · {resource.availabilityStatus}</small>
                      </span>
                      <span className="resource-row-status">
                        {resourceMapState(resource) === "mapped" ? "Mapped" : resourceMapState(resource) === "hidden" ? "Hidden" : "No map"}
                        {isResourceStale(resource) ? " · stale" : ""}
                      </span>
                    </button>
                    <div className="button-row">
                      <button className="secondary" onClick={() => onNavigate(`/resources/${resource.id}`)}>Open</button>
                      <button className="secondary" onClick={() => void copyPublicUrl(`/resources/${resource.id}`)}>Copy URL</button>
                      {resourceMapState(resource) === "mapped" && <button className="secondary" onClick={() => onNavigate(`/map?type=resource&id=${resource.id}`)}>Map</button>}
                      <button className="secondary" onClick={() => void updateResourceAvailability(resource, "open")}>Open status</button>
                      <button className="secondary" onClick={() => void updateResourceAvailability(resource, "full")}>Full</button>
                      <button className="secondary" onClick={() => void updateResourceAvailability(resource, "closed")}>Closed</button>
                      <button className="secondary" onClick={() => void markResourceVerified(resource)}>Mark verified</button>
                    </div>
                  </article>
                ))}
                {!filteredAdminResources.length && <p className="empty">No resources match these filters.</p>}
              </div>
            </section>

            <section className="card resource-editor-panel">
              <div className="form-card-header">
                <div>
                  <p className="eyebrow">{editingResource ? "Edit resource" : "Create resource"}</p>
                  <h2>{editingResource?.name ?? "New resource"}</h2>
                </div>
                {editingResource && isResourceStale(editingResource) && <span className="badge warning">Needs verification</span>}
              </div>
              {editingResource && resourceMapState(editingResource) === "mapped" && (
                <div className="resource-map-preview admin-preview">
                  <LeafletMap features={[resourceToMapFeature(editingResource)]} config={config} selectedFeatureId={editingResource.id} onNavigate={() => undefined} />
                </div>
              )}
              {editingResource && resourceMapState(editingResource) !== "mapped" && (
                <p className="map-hint">
                  {resourceMapState(editingResource) === "hidden"
                    ? "This resource has coordinates, but map visibility is hidden."
                    : "No coordinates set. Add latitude and longitude to publish this resource on the map."}
                </p>
              )}
              <CoordinatePickerMap
                key={`resource-picker-${editingResource?.id ?? "new"}`}
                config={config}
                lat={editingResource?.lat}
                lng={editingResource?.lng}
                formId="admin-resource-editor-form"
                latField="lat"
                lngField="lng"
              />
              <form id="admin-resource-editor-form" className="stacked-form admin-form resource-editor-form" key={editingResource?.id ?? "new-resource"} onSubmit={saveResource}>
                <input name="id" type="hidden" defaultValue={editingResource?.id ?? ""} />
                <label>
                  Type
                  <select name="type" required defaultValue={editingResource?.type ?? "shelter"}>{resourceTypes.map((type) => <option value={type} key={type}>{resourceTypeLabels[type]}</option>)}</select>
                </label>
                <label>
                  Name
                  <input name="name" placeholder="Name" required defaultValue={editingResource?.name ?? ""} />
                </label>
                <label>
                  Availability
                  <select name="availabilityStatus" defaultValue={editingResource?.availabilityStatus ?? "unknown"}>
                    <option value="unknown">Unknown</option>
                    <option value="open">Open</option>
                    <option value="full">Full</option>
                    <option value="closed">Closed</option>
                  </select>
                </label>
                <label className="full-span">
                  Description
                  <textarea name="description" placeholder="Description" defaultValue={editingResource?.description ?? ""} />
                </label>
                <label>
                  City
                  <input name="city" placeholder="City" defaultValue={editingResource?.city ?? ""} />
                </label>
                <label>
                  State or region
                  <input name="admin1" placeholder="State or region" defaultValue={editingResource?.admin1 ?? ""} />
                </label>
                <label className="full-span">
                  Address or area
                  <input name="address" placeholder="Address or area" defaultValue={editingResource?.address ?? ""} />
                </label>
                <label>
                  Latitude
                  <input name="lat" inputMode="decimal" placeholder="10.5000" defaultValue={editingResource?.lat ?? ""} />
                </label>
                <label>
                  Longitude
                  <input name="lng" inputMode="decimal" placeholder="-66.9167" defaultValue={editingResource?.lng ?? ""} />
                </label>
                <label>
                  Location precision
                  <select name="locationPrecision" defaultValue={editingResource?.locationPrecision ?? "area"}>
                    <option value="exact">Exact</option>
                    <option value="area">Area</option>
                    <option value="city">City only</option>
                    <option value="hidden">Hide from map</option>
                  </select>
                </label>
                <label>
                  Hours
                  <input name="hours" placeholder="Hours" defaultValue={editingResource?.hours ?? ""} />
                </label>
                <label>
                  Capacity
                  <input name="capacity" placeholder="Capacity" defaultValue={editingResource?.capacity ?? ""} />
                </label>
                <label>
                  Accepted groups
                  <input name="acceptedGroups" placeholder="Families, children, pets..." defaultValue={editingResource?.acceptedGroups ?? ""} />
                </label>
                <label>
                  Accessibility
                  <input name="accessibility" placeholder="Wheelchair access, stairs, transport" defaultValue={editingResource?.accessibility ?? ""} />
                </label>
                <label className="full-span">
                  Services or supplies
                  <textarea name="services" placeholder="Medical intake, water, food, charging, legal aid..." defaultValue={editingResource?.services ?? editingResource?.supplies ?? ""} />
                </label>
                <label className="full-span">
                  Current needs
                  <textarea name="currentNeeds" placeholder="Blankets, translators, generators, transport..." defaultValue={editingResource?.currentNeeds ?? ""} />
                </label>
                <label>
                  Verification
                  <select name="verificationLevel" defaultValue={editingResource?.verificationLevel ?? "contact_verified"}>
                    {Object.entries(verificationLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                  </select>
                </label>
                <label>
                  Public contact
                  <input name="contactPublic" placeholder="Phone, email, URL" defaultValue={editingResource?.contactPublic ?? ""} />
                </label>
                <label>
                  Source URL
                  <input name="sourceUrl" placeholder="https://..." defaultValue={editingResource?.sourceUrl ?? ""} />
                </label>
                <label>
                  Donation URL
                  <input name="donationUrl" placeholder="https://..." defaultValue={editingResource?.donationUrl ?? ""} />
                </label>
                <label>
                  Donation verification
                  <select name="donationVerificationStatus" defaultValue={editingResource?.donationVerificationStatus ?? "none"}>
                    <option value="none">No donation link</option>
                    <option value="pending">Pending verification</option>
                    <option value="verified">Verified</option>
                    <option value="rejected">Rejected</option>
                  </select>
                </label>
                <label className="checkbox-row">
                  <input name="protectedLocation" type="checkbox" value="yes" defaultChecked={Boolean(editingResource?.protectedLocation)} />
                  Protect exact location from public map
                </label>
                <label>
                  Organization
                  <select name="organizationId" defaultValue={editingResource?.organizationId ?? ""}>
                    <option value="">No organization</option>
                    {organizations.map((organization) => <option value={organization.id} key={organization.id}>{organization.name}</option>)}
                  </select>
                </label>
                <div className="button-row full-span">
                  <button type="submit">{editingResource ? "Update resource" : "Create resource"}</button>
                  {editingResource && resourceMapState(editingResource) === "mapped" && <button className="secondary" type="button" onClick={() => onNavigate(`/map?type=resource&id=${editingResource.id}`)}>Open public map</button>}
                  {editingResource && <button className="secondary" type="button" onClick={() => setEditingResource(null)}>Cancel edit</button>}
                </div>
              </form>
            </section>
          </div>
        </section>
      )}

      {tab === "contacts" && (
        <section className="admin-table-section">
          <h2>Emergency contacts</h2>
          <form className="card stacked-form admin-form" onSubmit={saveContact}>
            <input name="id" placeholder="Existing contact ID, optional" />
            <input name="label" placeholder="Label" required />
            <input name="contact" placeholder="Phone, URL, radio, or email" required />
            <input name="description" placeholder="Description" />
            <button type="submit">Save contact</button>
          </form>
          <div className="admin-table">
            {contacts.map((contact) => (
              <article className="card admin-row" key={contact.id}>
                <div>
                  <strong>{contact.label}</strong>
                  <p>{contact.contact} · {contact.description ?? "No description"}</p>
                  <small>{contact.id}</small>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {tab === "updates" && (
        <section className="admin-table-section">
          <h2>Public updates</h2>
          <form className="card stacked-form admin-form" onSubmit={saveUpdate}>
            <input name="id" placeholder="Existing update ID, optional" />
            <input name="title" placeholder="Title" required />
            <input name="type" placeholder="situation_update" />
            <input name="source" placeholder="Source" />
            <select name="verificationLevel" defaultValue="contact_verified">
              <option value="unverified">Community report</option>
              <option value="contact_verified">Contact verified</option>
              <option value="org_verified">Organization verified</option>
              <option value="official_verified">Officially verified</option>
            </select>
            <input name="locale" placeholder="en" />
            <label className="checkbox-row">
              <input name="pinned" type="checkbox" value="yes" />
              Pin this update
            </label>
            <textarea name="body" placeholder="Update body" required />
            <button type="submit">Save update</button>
          </form>
          <div className="admin-table">
            {updates.map((update) => (
              <article className="card admin-row" key={update.id}>
                <div>
                  <strong>{update.title}</strong>
                  <p>{update.type.replaceAll("_", " ")} · {verificationLabels[update.verificationLevel]}</p>
                  <small>{update.id}</small>
                </div>
                <div className="button-row">
                  <button className="secondary" onClick={() => onNavigate(`/updates/${update.id}`)}>Open</button>
                  <button className="secondary" onClick={() => void copyPublicUrl(`/updates/${update.id}`)}>Copy URL</button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {tab === "organizations" && (
        <section className="admin-table-section">
          <h2>Organizations</h2>
          <form className="card stacked-form admin-form" onSubmit={saveOrganization}>
            <input name="id" placeholder="Existing organization ID, optional" />
            <input name="name" placeholder="Name" required />
            <input name="type" placeholder="NGO, hospital, shelter..." required />
            <input name="website" placeholder="Website" />
            <input name="contactPublic" placeholder="Public contact" />
            <select name="verificationStatus" defaultValue="contact_verified">
              <option value="unverified">Community report</option>
              <option value="contact_verified">Contact verified</option>
              <option value="org_verified">Organization verified</option>
              <option value="official_verified">Officially verified</option>
            </select>
            <textarea name="description" placeholder="Description" />
            <button type="submit">Save organization</button>
          </form>
          <form className="card stacked-form admin-form" onSubmit={assignOrganization}>
            <select name="entityRef" required>
              <option value="">Report or resource</option>
              <optgroup label="Reports">
                {reports.map((report) => <option value={`report:${report.id}`} key={report.id}>{report.displayName} · {report.type.replaceAll("_", " ")}</option>)}
              </optgroup>
              <optgroup label="Resources">
                {resources.map((resource) => <option value={`resource:${resource.id}`} key={resource.id}>{resource.name} · {resourceTypeLabels[resource.type]}</option>)}
              </optgroup>
            </select>
            <select name="organizationId" required>
              <option value="">Organization</option>
              {organizations.map((organization) => <option value={organization.id} key={organization.id}>{organization.name}</option>)}
            </select>
            <button type="submit">Assign organization</button>
          </form>
          <div className="admin-table">
            {organizations.map((organization) => (
              <article className="card admin-row" key={organization.id}>
                <div>
                  <strong>{organization.name}</strong>
                  <p>{organization.type} · {verificationLabels[organization.verificationStatus]}</p>
                  <small>{organization.id}</small>
                </div>
                <div className="button-row">
                  <button className="secondary" onClick={() => onNavigate(`/organizations/${organization.id}`)}>Open</button>
                  <button className="secondary" onClick={() => void copyPublicUrl(`/organizations/${organization.id}`)}>Copy URL</button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {tab === "organizationApplications" && (
        <section className="admin-table-section">
          <h2>Organization applications</h2>
          <div className="admin-table">
            {organizationApplications.map((application) => (
              <article className="card admin-row" key={application.id}>
                <div>
                  <strong>{application.name}</strong>
                  <p>{application.type} · {application.status}</p>
                  <small>{application.website ?? "No website"} · {application.verificationEvidence ?? "No evidence provided"}</small>
                </div>
                <div className="button-row">
                  <button onClick={() => void approveOrganizationApplication(application.id)}>Approve</button>
                  <button className="secondary" onClick={() => void rejectOrganizationApplication(application.id)}>Reject</button>
                </div>
              </article>
            ))}
            {!organizationApplications.length && <p className="empty">No organization applications yet.</p>}
          </div>
        </section>
      )}

      {tab === "volunteers" && (
        <section className="admin-table-section">
          <h2>Volunteers</h2>
          <form className="card stacked-form admin-form" onSubmit={saveVolunteerAssignment}>
            <select name="volunteerId" required>
              <option value="">Volunteer</option>
              {volunteers.map((volunteer) => <option value={volunteer.id} key={volunteer.id}>{volunteer.name} · {volunteer.status}</option>)}
            </select>
            <select name="organizationId">
              <option value="">No organization</option>
              {organizations.map((organization) => <option value={organization.id} key={organization.id}>{organization.name}</option>)}
            </select>
            <input name="taskLabel" required placeholder="Task or assignment" />
            <input name="notesPrivate" placeholder="Private notes" />
            <button type="submit">Assign volunteer</button>
          </form>
          <div className="admin-table">
            {volunteers.map((volunteer) => (
              <article className="card admin-row" key={volunteer.id}>
                <div>
                  <strong>{volunteer.name}</strong>
                  <p>{volunteer.location ?? "No location"} · {volunteer.skills ?? "No skills listed"}</p>
                  <small>{volunteer.status} · {volunteer.availability ?? "availability unknown"}</small>
                </div>
                <div className="button-row">
                  <button onClick={() => void updateVolunteer(volunteer.id, "available")}>Available</button>
                  <button className="secondary" onClick={() => void updateVolunteer(volunteer.id, "assigned")}>Assigned</button>
                  <button className="secondary" onClick={() => void updateVolunteer(volunteer.id, "inactive")}>Inactive</button>
                </div>
              </article>
            ))}
            {!volunteers.length && <p className="empty">No volunteer registrations yet.</p>}
          </div>
          <h3>Assignments</h3>
          <div className="admin-table">
            {volunteerAssignments.map((assignment) => (
              <article className="card admin-row" key={assignment.id}>
                <div>
                  <strong>{assignment.taskLabel}</strong>
                  <p>{volunteers.find((volunteer) => volunteer.id === assignment.volunteerId)?.name ?? assignment.volunteerId} · {assignment.status}</p>
                  <small>{organizations.find((organization) => organization.id === assignment.organizationId)?.name ?? assignment.organizationId ?? "No organization"}</small>
                </div>
                <div className="button-row">
                  <button onClick={() => void updateVolunteerAssignment(assignment.id, "assigned")}>Assigned</button>
                  <button className="secondary" onClick={() => void updateVolunteerAssignment(assignment.id, "complete")}>Complete</button>
                  <button className="secondary" onClick={() => void updateVolunteerAssignment(assignment.id, "cancelled")}>Cancel</button>
                </div>
              </article>
            ))}
            {!volunteerAssignments.length && <p className="empty">No volunteer assignments yet.</p>}
          </div>
        </section>
      )}

      {tab === "mapLayers" && (
        <section className="admin-table-section">
          <h2>Map layers</h2>
          <form className="card stacked-form admin-form" onSubmit={saveMapLayer}>
            <select name="type" defaultValue="service_area">
              <option value="road_closure">Road closure</option>
              <option value="evacuation_zone">Evacuation zone</option>
              <option value="service_area">Service area</option>
              <option value="volunteer_area">Volunteer area</option>
              <option value="resource_gap">Resource coverage gap</option>
            </select>
            <input name="label" required placeholder="Layer label" />
            <select name="visibility" defaultValue="public">
              <option value="public">Public</option>
              <option value="admin">Admin only</option>
              <option value="hidden">Hidden</option>
            </select>
            <select name="verificationLevel" defaultValue="contact_verified">
              {Object.entries(verificationLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
            </select>
            <textarea className="full-span" name="description" placeholder="Description" />
            <textarea className="full-span" name="geometry" required placeholder='{"type":"Point","coordinates":[-66.9,10.5]}' />
            <button type="submit">Save map layer</button>
          </form>
          <div className="admin-table">
            {mapLayers.map((layer) => (
              <article className="card admin-row" key={layer.id}>
                <div>
                  <strong>{layer.label}</strong>
                  <p>{layer.type.replaceAll("_", " ")} · {layer.status} · {layer.visibility}</p>
                  <small>{layer.description ?? layer.sourceUrl ?? layer.id}</small>
                </div>
                <button className="secondary" onClick={() => onNavigate(`/map?type=layer&id=${layer.id}`)}>Open map</button>
              </article>
            ))}
            {!mapLayers.length && <p className="empty">No map layers yet.</p>}
          </div>
        </section>
      )}

      {tab === "translations" && (
        <section className="admin-table-section">
          <h2>Translations</h2>
          <form className="card stacked-form admin-form" onSubmit={saveResourceTranslation}>
            <select name="resourceId" required>
              <option value="">Resource</option>
              {resources.map((resource) => <option value={resource.id} key={resource.id}>{resource.name}</option>)}
            </select>
            <input name="locale" required placeholder="es-VE" />
            <input name="name" placeholder="Translated name" />
            <input name="services" placeholder="Translated services" />
            <textarea className="full-span" name="description" placeholder="Translated description" />
            <textarea className="full-span" name="currentNeeds" placeholder="Translated current needs" />
            <button type="submit">Save resource translation</button>
          </form>
          <form className="card stacked-form admin-form" onSubmit={saveLocaleOverride}>
            <input name="locale" required placeholder="Locale" />
            <input name="namespace" required placeholder="Namespace" />
            <input name="key" required placeholder="Key" />
            <input name="value" required placeholder="Translated value" />
            <button type="submit">Save locale override</button>
          </form>
          <div className="admin-table">
            {[...resourceTranslations, ...localeOverrides].map((item) => (
              <article className="card admin-row" key={"resourceId" in item ? `rt-${item.id}` : `lo-${item.id}`}>
                <div>
                  <strong>{"resourceId" in item ? `${item.locale} resource translation` : `${item.locale} ${item.namespace}.${item.key}`}</strong>
                  <p>{"resourceId" in item ? resources.find((resource) => resource.id === item.resourceId)?.name ?? item.resourceId : item.value}</p>
                </div>
              </article>
            ))}
            {!resourceTranslations.length && !localeOverrides.length && <p className="empty">No translations yet.</p>}
          </div>
        </section>
      )}

      {tab === "imports" && (
        <section className="admin-table-section">
          <h2>Imports and exports</h2>
          <form className="card stacked-form admin-form" onSubmit={saveImport}>
            <select name="type" defaultValue="resources">
              <option value="resources">Resources CSV</option>
              <option value="contacts">Emergency contacts CSV</option>
              <option value="admin_areas">Admin areas CSV</option>
            </select>
            <input name="file" type="file" accept=".csv,text/csv" required />
            <button type="submit">Queue import</button>
          </form>
          <form className="card stacked-form admin-form" onSubmit={saveExport}>
            <select name="type" defaultValue="reports">
              <option value="reports">Reports CSV</option>
              <option value="resources">Resources CSV</option>
              <option value="contacts">Emergency contacts CSV</option>
              <option value="volunteers">Volunteers CSV</option>
            </select>
            <button type="submit">Queue export</button>
          </form>
          <div className="admin-table">
            {[...imports, ...exportsList].map((job) => (
              <article className="card admin-row" key={`${"downloadUrl" in job ? "export" : "import"}-${job.id}`}>
                <div>
                  <strong>{"downloadUrl" in job ? "Export" : "Import"}: {job.type}</strong>
                  <p>{job.status}</p>
                  <small>{"processedRows" in job ? `${job.processedRows}/${job.totalRows} rows` : `${job.rowCount} rows`}</small>
                </div>
                {"downloadUrl" in job && job.downloadUrl && <a className="button" href={job.downloadUrl}>Download</a>}
              </article>
            ))}
          </div>
        </section>
      )}

      {tab === "memberships" && (
        <section className="admin-table-section">
          <h2>Organization memberships</h2>
          <form className="card stacked-form admin-form" onSubmit={saveMembership}>
            <select name="organizationId" required>
              <option value="">Organization</option>
              {organizations.map((organization) => <option value={organization.id} key={organization.id}>{organization.name}</option>)}
            </select>
            <select name="userId" required>
              <option value="">User</option>
              {users.map((user) => <option value={user.id} key={user.id}>{user.email}</option>)}
            </select>
            <select name="role" defaultValue="organization_manager">
              <option value="organization_manager">Organization manager</option>
              <option value="viewer">Viewer</option>
            </select>
            <button type="submit">Save membership</button>
          </form>
          <div className="admin-table">
            {memberships.map((membership) => (
              <article className="card admin-row" key={membership.id}>
                <div>
                  <strong>{membership.organizationName ?? membership.organizationId}</strong>
                  <p>{membership.userEmail ?? membership.userId} · {membership.role.replaceAll("_", " ")}</p>
                  <small>{membership.id}</small>
                </div>
                <button className="secondary" onClick={() => void deleteMembership(membership.id)}>Remove</button>
              </article>
            ))}
            {!memberships.length && <p className="empty">No organization memberships yet.</p>}
          </div>
        </section>
      )}

      {tab === "apiClients" && (
        <section className="admin-table-section">
          <div className="section-header">
            <div>
              <p className="eyebrow">Trusted integrations</p>
              <h2>Partner API clients</h2>
            </div>
            <a className="button secondary" href="/api/v1/openapi.json" target="_blank" rel="noreferrer"><FileText aria-hidden="true" /> OpenAPI</a>
          </div>
          <form className="card stacked-form admin-form api-client-form" onSubmit={createPartnerApiClient}>
            <label className="full-span">
              Client name
              <input name="name" required placeholder="Hospital intake system, NGO dashboard..." />
            </label>
            <fieldset className="form-section full-span">
              <legend>Scopes</legend>
              {["reports:read", "pets:read", "resources:read", "organizations:read", "updates:read", "map:read"].map((scope) => (
                <label className="checkbox-row" key={scope}>
                  <input name="scopes" type="checkbox" value={scope} defaultChecked={scope !== "map:read"} />
                  {scope}
                </label>
              ))}
            </fieldset>
            <button type="submit"><KeyRound aria-hidden="true" /> Create client</button>
          </form>
          {newApiToken && (
            <section className="card token-panel">
              <div>
                <p className="eyebrow">Copy once</p>
                <h3>New partner token</h3>
              </div>
              <code>{newApiToken}</code>
            </section>
          )}
          <div className="admin-table">
            {apiClients.map((client) => (
              <article className="card admin-row" key={client.id}>
                <div>
                  <strong>{client.name}</strong>
                  <p>{client.status} · {client.scopes.join(", ")}</p>
                  <small>Last used {client.lastUsedAt ? new Date(client.lastUsedAt).toLocaleString() : "never"}</small>
                </div>
                <div className="button-row">
                  {client.status !== "revoked" && <button className="secondary" onClick={() => void revokePartnerApiClient(client.id)}>Revoke</button>}
                </div>
              </article>
            ))}
            {!apiClients.length && <p className="empty">No partner API clients yet.</p>}
          </div>
        </section>
      )}

      {tab === "files" && (
        <section className="admin-table-section">
          <h2>Generated files</h2>
          <form className="card stacked-form admin-form" onSubmit={generateFile}>
            <select name="type" defaultValue="flyer_pdf">
              <option value="flyer_pdf">A4 report flyer PDF</option>
              <option value="flyer_a5_pdf">A5 report flyer PDF</option>
              <option value="flyer_mini4_pdf">Four-per-page mini flyers PDF</option>
              <option value="flyer_poster_pdf">QR poster PDF</option>
              <option value="pet_flyer_pdf">Missing/found pet flyer PDF</option>
              <option value="resource_sheet_pdf">Resource sheet PDF</option>
              <option value="resource_sheet_csv">Resource sheet CSV</option>
            </select>
            <select name="entityRef" defaultValue="">
              <option value="">No linked entity</option>
              <optgroup label="Reports">
                {reports.map((report) => <option value={`report:${report.id}`} key={report.id}>{report.displayName} · {report.type.replaceAll("_", " ")}</option>)}
              </optgroup>
              <optgroup label="Resources">
                {resources.map((resource) => <option value={`resource:${resource.id}`} key={resource.id}>{resource.name} · {resourceTypeLabels[resource.type]}</option>)}
              </optgroup>
            </select>
            <input name="label" placeholder="Label, optional" />
            <button type="submit">Generate file</button>
          </form>
          <div className="admin-table">
            {generatedFiles.map((file) => (
              <article className="card admin-row" key={file.id}>
                <div>
                  <strong>{file.label ?? file.type}</strong>
                  <p>{file.type} · {file.status} · {file.mimeType}</p>
                  <small>{file.entityType ?? "general"} {file.entityId ?? ""}</small>
                </div>
                <a className="button" href={file.downloadUrl}>Download</a>
              </article>
            ))}
            {!generatedFiles.length && <p className="empty">No generated files yet.</p>}
          </div>
        </section>
      )}

      {tab === "email" && (
        <section className="admin-table-section">
          <h2>Inbound email tips</h2>
          <div className="admin-table">
            {inboundEmails.map((emailTip) => (
              <article className="card admin-row" key={emailTip.id}>
                <div>
                  <strong>{emailTip.subject ?? "No subject"}</strong>
                  <p>{emailTip.fromEmail ?? "Unknown sender"} · {emailTip.status}</p>
                  <small>{emailTip.relatedReportId ?? "No linked report"} · tip {emailTip.createdTipId ?? "not created"}</small>
                </div>
              </article>
            ))}
            {!inboundEmails.length && <p className="empty">No inbound emails yet.</p>}
          </div>
        </section>
      )}

      {tab === "geodata" && (
        <section className="admin-table-section">
          <h2>Geodata imports</h2>
          <form className="card stacked-form admin-form" onSubmit={saveGeodataImport}>
            <select name="type" defaultValue="resources_geojson">
              <option value="resources_geojson">Resources GeoJSON</option>
              <option value="admin_areas_geojson">Admin areas GeoJSON</option>
              <option value="map_layers_geojson">Map layers GeoJSON</option>
            </select>
            <input name="file" type="file" accept=".geojson,.json,application/geo+json,application/json" required />
            <button type="submit">Queue geodata import</button>
          </form>
          <div className="admin-table">
            {geodataImports.map((job) => (
              <article className="card admin-row" key={job.id}>
                <div>
                  <strong>{job.type.replaceAll("_", " ")}</strong>
                  <p>{job.status} · {job.processedFeatures}/{job.totalFeatures} features</p>
                  <small>{job.errors[0] ?? job.sourceFilename ?? job.id}</small>
                </div>
              </article>
            ))}
            {!geodataImports.length && <p className="empty">No geodata imports yet.</p>}
          </div>
        </section>
      )}

      {tab === "notifications" && (
        <section className="admin-table-section">
          <h2>Notifications</h2>
          <form className="card stacked-form admin-form" onSubmit={sendTestNotification}>
            <select name="channel" defaultValue="email">
              <option value="email">Email</option>
              <option value="sms">SMS</option>
              <option value="whatsapp">WhatsApp</option>
            </select>
            <input name="recipient" placeholder="Recipient" required />
            <input name="templateKey" placeholder="admin_test" />
            <input name="message" placeholder="Message" />
            <button type="submit"><Bell aria-hidden="true" /> Queue test</button>
          </form>
          <div className="admin-table">
            {notifications.map((notification) => (
              <article className="card admin-row" key={notification.id}>
                <div>
                  <strong>{notification.templateKey}</strong>
                  <p>{notification.channel} to {notification.recipient} · {notification.status}</p>
                  <small>{notification.lastError ?? `${notification.attempts} attempts`}</small>
                </div>
                <div className="button-row">
                  <button className="secondary" onClick={() => void processNotification(notification.id)}>Process</button>
                  <button className="secondary" onClick={() => void cancelNotification(notification.id)}>Cancel</button>
                </div>
              </article>
            ))}
            {!notifications.length && <p className="empty">No notification events yet.</p>}
          </div>
        </section>
      )}

      {tab === "workflows" && (
        <section className="admin-table-section">
          <h2>Workflows</h2>
          <form className="card stacked-form admin-form" onSubmit={startWorkflow}>
            <select name="type" defaultValue="report_verification">
              <option value="report_verification">Report verification</option>
              <option value="organization_onboarding">Organization onboarding</option>
              <option value="volunteer_credential_review">Volunteer credential review</option>
              <option value="large_import">Large import</option>
              <option value="retention_cleanup">Retention cleanup</option>
            </select>
            <select name="entityRef" defaultValue="">
              <option value="">No linked entity</option>
              <optgroup label="Reports">
                {reports.map((report) => <option value={`report:${report.id}`} key={report.id}>{report.displayName} · {report.type.replaceAll("_", " ")}</option>)}
              </optgroup>
              <optgroup label="Resources">
                {resources.map((resource) => <option value={`resource:${resource.id}`} key={resource.id}>{resource.name} · {resourceTypeLabels[resource.type]}</option>)}
              </optgroup>
              <optgroup label="Organizations">
                {organizations.map((organization) => <option value={`organization:${organization.id}`} key={organization.id}>{organization.name}</option>)}
              </optgroup>
            </select>
            <button type="submit">Start workflow</button>
          </form>
          <div className="admin-table">
            {workflows.map((workflow) => (
              <article className="card admin-row" key={workflow.id}>
                <div>
                  <strong>{workflow.type.replaceAll("_", " ")}</strong>
                  <p>{workflow.status} · {workflow.step}</p>
                  <small>{[workflow.entityType, workflow.entityId].filter(Boolean).join(": ") || workflow.id}</small>
                </div>
              </article>
            ))}
            {!workflows.length && <p className="empty">No workflow runs yet.</p>}
          </div>
        </section>
      )}

      {tab === "ai" && (
        <section className="admin-table-section">
          <h2>AI suggestions</h2>
          <form className="card stacked-form admin-form" onSubmit={requestAiSuggestion}>
            <select name="kind" defaultValue="moderation">
              <option value="moderation">Moderation suggestion</option>
              <option value="translation">Translation draft</option>
            </select>
            <select name="entityRef" defaultValue="">
              <option value="">No linked entity</option>
              <optgroup label="Reports">
                {reports.map((report) => <option value={`report:${report.id}`} key={report.id}>{report.displayName} · {report.type.replaceAll("_", " ")}</option>)}
              </optgroup>
              <optgroup label="Resources">
                {resources.map((resource) => <option value={`resource:${resource.id}`} key={resource.id}>{resource.name} · {resourceTypeLabels[resource.type]}</option>)}
              </optgroup>
              <optgroup label="Updates">
                {updates.map((update) => <option value={`update:${update.id}`} key={update.id}>{update.title}</option>)}
              </optgroup>
            </select>
            <input name="locale" placeholder="Locale for translation" />
            <textarea name="text" placeholder="Text for suggestion or translation" />
            <button type="submit"><Brain aria-hidden="true" /> Create suggestion</button>
          </form>
          <div className="admin-table">
            {aiSuggestions.map((suggestion) => (
              <article className="card admin-row" key={suggestion.id}>
                <div>
                  <strong>{suggestion.type.replaceAll("_", " ")}</strong>
                  <p>{String(suggestion.suggestion.label ?? suggestion.suggestion.locale ?? "suggested")} · {suggestion.status}</p>
                  <small>{String(suggestion.suggestion.note ?? suggestion.suggestion.summary ?? suggestion.id)}</small>
                </div>
              </article>
            ))}
            {!aiSuggestions.length && <p className="empty">No AI suggestions yet.</p>}
          </div>
        </section>
      )}

      {tab === "users" && (
        <section className="admin-table-section">
          <h2>Users and roles</h2>
          <form className="card stacked-form admin-form" onSubmit={saveUser}>
            <input name="email" type="email" placeholder="email@example.org" required />
            <input name="name" placeholder="Name" />
            <select name="role" defaultValue="moderator">{roles.map((role) => <option value={role} key={role}>{role.replaceAll("_", " ")}</option>)}</select>
            <button type="submit">Create user</button>
          </form>
          <div className="admin-table">
            {users.map((user) => (
              <article className="card admin-row" key={user.id}>
                <div>
                  <strong>{user.email}</strong>
                  <p>{user.name ?? "No name"} · {user.role.replaceAll("_", " ")}</p>
                </div>
                <select value={user.role} onChange={(event) => void changeUserRole(user.id, event.target.value)}>
                  {roles.map((role) => <option value={role} key={role}>{role.replaceAll("_", " ")}</option>)}
                </select>
              </article>
            ))}
          </div>
        </section>
      )}

      {tab === "tips" && (
        <section className="admin-table-section">
          <h2>Tips</h2>
          <div className="admin-table">
            {tips.map((tip) => (
              <article className="card admin-row" key={String(tip.id)}>
                <div>
                  <strong>{String(tip.report_display_name ?? "Unknown report")}</strong>
                  <p>{String(tip.body ?? "")}</p>
                  <small>{formatPrivateContact(tip.tipper_contact_private)}</small>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {tab === "privacy" && (
        <section className="admin-table-section">
          <h2>Privacy and data requests</h2>
          <div className="admin-table">
            {dataRequests.map((request) => (
              <article className="card admin-row" key={request.id}>
                <div>
                  <strong>{request.type}</strong>
                  <p>{request.details ?? "No details"} · {request.status}</p>
                  <small>{request.reportId ?? "No report linked"}</small>
                </div>
                <div className="button-row">
                  <button onClick={() => void updateDataRequest(request.id, "in_review")}>In review</button>
                  <button className="secondary" onClick={() => void generateDataRequestExport(request.id)}>Generate export</button>
                  {request.resultUrl && <a className="button" href={request.resultUrl}>Download</a>}
                  <button className="secondary" onClick={() => void updateDataRequest(request.id, "complete")}>Complete</button>
                  <button className="secondary" onClick={() => void updateDataRequest(request.id, "rejected")}>Reject</button>
                </div>
              </article>
            ))}
            {!dataRequests.length && <p className="empty">No privacy requests.</p>}
          </div>
        </section>
      )}

      {tab === "retention" && (
        <section className="admin-table-section">
          <h2>Retention and crisis mode</h2>
          {retentionPolicy && (
            <form className="card stacked-form admin-form" onSubmit={saveRetentionPolicy}>
              <input name="tipsDaysAfterClosure" type="number" min="1" max="3650" defaultValue={retentionPolicy.tipsDaysAfterClosure} />
              <input name="auditLogDays" type="number" min="1" max="3650" defaultValue={retentionPolicy.auditLogDays} />
              <input name="volunteerDaysAfterCrisis" type="number" min="1" max="3650" defaultValue={retentionPolicy.volunteerDaysAfterCrisis} />
              <label className="checkbox-row">
                <input name="enabled" type="checkbox" value="yes" defaultChecked={retentionPolicy.enabled} />
                Enable cleanup
              </label>
              <button type="submit">Save policy</button>
            </form>
          )}
          <form className="card stacked-form admin-form" onSubmit={saveCrisisMode}>
            <label className="checkbox-row">
              <input name="enabled" type="checkbox" value="yes" defaultChecked={config?.crisisMode.enabled} />
              Crisis mode
            </label>
            <label className="checkbox-row">
              <input name="disableMaps" type="checkbox" value="yes" defaultChecked={config?.crisisMode.disableMaps} />
              Disable maps
            </label>
            <label className="checkbox-row">
              <input name="preferLists" type="checkbox" value="yes" defaultChecked={config?.crisisMode.preferLists} />
              Prefer lists
            </label>
            <label className="checkbox-row">
              <input name="imageLight" type="checkbox" value="yes" defaultChecked={config?.crisisMode.imageLight} />
              Image-light mode
            </label>
            <button type="submit">Save crisis mode</button>
          </form>
          <div className="card stacked-form">
            <div className="button-row">
              <button onClick={() => void previewRetention()}>Preview cleanup</button>
              <button className="secondary" onClick={() => void runRetention()}>Run cleanup</button>
            </div>
            {retentionPreview && (
              <dl className="moderation-meta">
                {Object.entries(retentionPreview).map(([key, value]) => (
                  <div key={key}><dt>{key.replace(/([A-Z])/g, " $1")}</dt><dd>{value}</dd></div>
                ))}
              </dl>
            )}
          </div>
        </section>
      )}

      {tab === "audit" && (
        <section className="admin-table-section">
          <h2>Audit logs</h2>
          <div className="admin-table">
            {logs.map((log) => (
              <article className="card admin-row" key={String(log.id)}>
                <div>
                  <strong>{String(log.action)}</strong>
                  <p>{String(log.entity_type)} · {String(log.entity_id)}</p>
                  <small>{String(log.actor_email ?? "system")} · {String(log.created_at)}</small>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
        </div>
      </section>
    </main>
  );
}

function moderationTitle(item: Record<string, unknown>): string {
  const type = String(item.entity_type);
  if (type === "tip") return "Tip review";
  if (type === "general_tip") return "General tip review";
  if (type === "contact_message") return "Protected contact message";
  if (type === "abuse_report") return "Abuse or takedown request";
  if (type === "media_asset") return "Media review";
  if (type === "report_change_request") return "Reporter change request";
  return "Report review";
}

function formObject(form: FormData): Record<string, string | number> {
  const body: Record<string, string | number> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value !== "string" || !value.trim() || key === "id" || key === "entityRef") continue;
    body[key] = key === "sortOrder" ? Number(value) : value.trim();
  }
  return body;
}

function parseEntityRef(value: string): { type: string; id: string } | null {
  const [type, id] = value.split(":");
  if (!type || !id) return null;
  return { type, id };
}

function setFormField(formId: string, fieldName: string, value: string) {
  const form = document.getElementById(formId) as HTMLFormElement | null;
  const field = form?.elements.namedItem(fieldName) as HTMLInputElement | null;
  if (!field) return;
  field.value = value;
  field.dispatchEvent(new Event("input", { bubbles: true }));
  field.dispatchEvent(new Event("change", { bubbles: true }));
}

function formatPrivateContact(value: unknown): string {
  if (typeof value !== "string" || !value) return "Not provided";
  try {
    const parsed = JSON.parse(value) as { contact?: unknown };
    return typeof parsed.contact === "string" && parsed.contact ? parsed.contact : "Not provided";
  } catch {
    return value;
  }
}

function moduleEnabled(config: PublicConfig | null, key: string, fallback = true): boolean {
  if (!config) return fallback;
  return config.modules[key] ?? fallback;
}

function resourceModulesEnabled(config: PublicConfig | null): boolean {
  return moduleEnabled(config, "shelters", true) || moduleEnabled(config, "hospitals", true) || moduleEnabled(config, "aidCenters", true);
}

function moduleDescription(key: (typeof moduleKeys)[number]): string {
  const descriptions: Record<(typeof moduleKeys)[number], string> = {
    missingPeople: "Shows missing-person reports and the report flow.",
    foundPeople: "Shows found/safe reports and found-person reporting.",
    tips: "Allows public tips on existing cases and general community information.",
    flyers: "Enables printable report flyers.",
    shelters: "Includes shelters in the public resource directory.",
    hospitals: "Includes hospitals and clinics in resources.",
    aidCenters: "Includes aid centers, supply points, and support services.",
    missingPets: "Enables the dedicated missing/found pet module.",
    volunteers: "Shows volunteer registration.",
    emergencyContacts: "Shows official and support contact lines.",
    maps: "Shows the public map when crisis mode allows maps.",
    organizations: "Shows verified organizations and their resource pages.",
    publicUpdates: "Shows public updates and pinned guidance.",
    privacyRequests: "Shows correction, export, and takedown request forms."
  };
  return descriptions[key];
}

function modulePublicPath(key: (typeof moduleKeys)[number]): string | null {
  const paths: Partial<Record<(typeof moduleKeys)[number], string>> = {
    missingPeople: "/reports?type=missing_person",
    foundPeople: "/reports?type=found_person",
    shelters: "/resources",
    hospitals: "/resources",
    aidCenters: "/resources",
    missingPets: "/pets",
    volunteers: "/volunteer",
    emergencyContacts: "/#contacts",
    maps: "/map",
    organizations: "/organizations",
    publicUpdates: "/updates",
    privacyRequests: "/data-request"
  };
  return paths[key] ?? null;
}

function moduleRecordCount(
  key: (typeof moduleKeys)[number],
  data: {
    reports: PublicReport[];
    resources: PublicResource[];
    contacts: EmergencyContact[];
    updates: PublicUpdate[];
    organizations: PublicOrganization[];
    volunteers: VolunteerRegistration[];
    dataRequests: DataRequest[];
  }
): number {
  if (key === "missingPeople") return data.reports.filter((report) => report.type === "missing_person").length;
  if (key === "foundPeople") return data.reports.filter((report) => report.type === "found_person").length;
  if (key === "missingPets") return data.reports.filter((report) => report.type === "missing_pet" || report.type === "found_pet").length;
  if (key === "shelters") return data.resources.filter((resource) => resource.type === "shelter").length;
  if (key === "hospitals") return data.resources.filter((resource) => resource.type === "hospital" || resource.type === "clinic").length;
  if (key === "aidCenters") return data.resources.filter((resource) => !["shelter", "hospital", "clinic"].includes(resource.type)).length;
  if (key === "emergencyContacts") return data.contacts.length;
  if (key === "publicUpdates") return data.updates.length;
  if (key === "organizations") return data.organizations.length;
  if (key === "volunteers") return data.volunteers.length;
  if (key === "privacyRequests") return data.dataRequests.length;
  if (key === "maps") return data.resources.filter((resource) => resourceMapState(resource) === "mapped").length + data.reports.filter((report) => reportMapState(report) === "mapped").length;
  return 0;
}

function resourceHasCoordinates(resource: PublicResource): boolean {
  return resource.lat !== null && resource.lat !== undefined && resource.lng !== null && resource.lng !== undefined;
}

function resourceMapState(resource: PublicResource): "mapped" | "hidden" | "missing" {
  if (resource.locationPrecision === "hidden") return "hidden";
  return resourceHasCoordinates(resource) ? "mapped" : "missing";
}

function isResourceStale(resource: PublicResource): boolean {
  if (!resource.lastVerifiedAt) return true;
  return Date.now() - new Date(resource.lastVerifiedAt).getTime() > 7 * 24 * 60 * 60 * 1000;
}

function resourceToMapFeature(resource: PublicResource): MapFeature {
  return {
    id: resource.id,
    type: "resource",
    label: resource.name,
    category: resource.type,
    status: resource.availabilityStatus,
    locationLabel: [resource.address, resource.city, resource.admin1].filter(Boolean).join(", ") || null,
    lat: resource.lat ?? 0,
    lng: resource.lng ?? 0,
    precision: resource.locationPrecision ?? "area",
    url: `/resources/${resource.id}`,
    verificationLevel: resource.verificationLevel,
    updatedAt: resource.updatedAt
  };
}

function reportHasCoordinates(report: PublicReport): boolean {
  return report.lastSeenLat !== null && report.lastSeenLat !== undefined && report.lastSeenLng !== null && report.lastSeenLng !== undefined;
}

function reportMapState(report: PublicReport): "mapped" | "hidden" | "missing" {
  if (report.locationPrecision === "hidden") return "hidden";
  return reportHasCoordinates(report) ? "mapped" : "missing";
}

function reportToMapFeature(report: PublicReport): MapFeature {
  return {
    id: report.id,
    type: "report",
    label: report.displayName,
    category: report.type,
    status: report.status,
    locationLabel: [report.lastSeenText, report.lastSeenCity, report.lastSeenAdmin1].filter(Boolean).join(", ") || null,
    lat: report.lastSeenLat ?? 0,
    lng: report.lastSeenLng ?? 0,
    precision: report.locationPrecision,
    url: `/reports/${report.publicSlug}`,
    verificationLevel: report.verificationLevel,
    updatedAt: report.updatedAt
  };
}

function loadLeaflet(): Promise<LeafletNamespace> {
  const windowWithLeaflet = window as Window & { L?: LeafletNamespace };
  if (windowWithLeaflet.L) return Promise.resolve(windowWithLeaflet.L);
  if (leafletPromise) return leafletPromise;

  leafletPromise = new Promise((resolve, reject) => {
    if (!document.getElementById("leaflet-css")) {
      const link = document.createElement("link");
      link.id = "leaflet-css";
      link.rel = "stylesheet";
      link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      document.head.appendChild(link);
    }

    const existingScript = document.getElementById("leaflet-js") as HTMLScriptElement | null;
    if (existingScript) {
      existingScript.addEventListener("load", () => windowWithLeaflet.L ? resolve(windowWithLeaflet.L) : reject(new Error("Leaflet did not initialize")));
      existingScript.addEventListener("error", () => reject(new Error("Leaflet failed to load")));
      return;
    }

    const script = document.createElement("script");
    script.id = "leaflet-js";
    script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    script.async = true;
    script.onload = () => windowWithLeaflet.L ? resolve(windowWithLeaflet.L) : reject(new Error("Leaflet did not initialize"));
    script.onerror = () => reject(new Error("Leaflet failed to load"));
    document.head.appendChild(script);
  });

  return leafletPromise;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[character] ?? character);
}

function Breadcrumbs({
  items,
  onNavigate
}: {
  items: Array<{ label: string; href?: string }>;
  onNavigate: (path: string) => void;
}) {
  return (
    <nav className="breadcrumbs" aria-label="Breadcrumb">
      {items.map((item, index) => (
        <span key={`${item.label}-${index}`}>
          {item.href ? (
            <button onClick={() => onNavigate(item.href!)}>{item.label}</button>
          ) : (
            <span aria-current="page">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

function NotFoundPanel({ title, message, onNavigate }: { title: string; message: string; onNavigate: (path: string) => void }) {
  return (
    <main className="page-layout">
      <section className="card not-found-panel">
        <AlertTriangle aria-hidden="true" />
        <div>
          <p className="eyebrow">Unavailable</p>
          <h1>{title}</h1>
          <p>{message}</p>
          <div className="button-row">
            <button onClick={() => onNavigate("/")}>Home</button>
            <button className="secondary" onClick={() => onNavigate("/search")}>Search</button>
          </div>
        </div>
      </section>
    </main>
  );
}

function Footer({ config, onNavigate }: { config: PublicConfig | null; onNavigate: (path: string) => void }) {
  return (
    <footer className="site-footer">
      <div>
        <a href="http://emergos.org/" rel="noreferrer">http://emergos.org/</a>
        <span>Powered by emergOS</span>
      </div>
      <nav aria-label="Footer">
        {moduleEnabled(config, "volunteers", false) && <button onClick={() => onNavigate("/volunteer")}>Volunteer</button>}
        {moduleEnabled(config, "maps", false) && <button onClick={() => onNavigate("/map")}>Map</button>}
        {moduleEnabled(config, "publicUpdates", true) && <button onClick={() => onNavigate("/updates")}>Updates</button>}
        {moduleEnabled(config, "organizations", true) && <button onClick={() => onNavigate("/organizations")}>Organizations</button>}
        {moduleEnabled(config, "privacyRequests", true) && <button onClick={() => onNavigate("/data-request")}>Privacy request</button>}
        <button onClick={() => onNavigate("/admin")}>Admin</button>
      </nav>
    </footer>
  );
}

function useSeo(route: RouteState, config: PublicConfig | null) {
  useEffect(() => {
    const siteName = config?.brand.name ?? "emergOS";
    const area = config?.disaster.affectedAreaLabel ?? "Crisis response";
    const path = window.location.pathname;
    const canonical = `${window.location.origin}${path}`;

    let title = `${siteName} ${area}`;
    let description = "Search missing people, report found people, submit tips, and find emergency resources.";

    if (route.view === "reports") {
      const type = new URLSearchParams(route.search).get("type");
      title = type === "found_person" ? `Found people | ${siteName}` : type === "missing_person" ? `Missing people | ${siteName}` : `Reports | ${siteName}`;
      description = "Search public missing and found person reports with status, location, and verification labels.";
    } else if (route.view === "search") {
      title = `Search | ${siteName}`;
      description = "Search missing and found reports, shelters, resources, organizations, and public updates.";
    } else if (route.view === "report") {
      title = `Person report | ${siteName}`;
      description = "Public crisis report page with status, last seen area, contact mode, tips, and printable flyer.";
    } else if (route.view === "new-report") {
      title = `Submit a report | ${siteName}`;
      description = "Create a missing or found person report with contact consent and safety controls.";
    } else if (route.view === "resources") {
      title = `Emergency resources | ${siteName}`;
      description = "Find shelters, hospitals, aid centers, and verified emergency resources.";
    } else if (route.view === "map") {
      title = `Map | ${siteName}`;
      description = "View mapped emergency resources and public reports with list fallback for crisis mode.";
    } else if (route.view === "resource") {
      title = `Emergency resource | ${siteName}`;
      description = "Emergency resource details, verification label, contact information, and safety request form.";
    } else if (route.view === "updates" || route.view === "update") {
      title = `Public updates | ${siteName}`;
      description = "Verified public guidance, corrections, and situation updates.";
    } else if (route.view === "organizations" || route.view === "organization") {
      title = `Organizations | ${siteName}`;
      description = "Verified response organizations and their public emergency resources.";
    } else if (route.view === "admin") {
      title = `Admin | ${siteName}`;
      description = "Moderation and crisis response administration.";
    }

    document.title = title;
    setMeta("description", description);
    setMeta("og:title", title, "property");
    setMeta("og:description", description, "property");
    setMeta("og:url", canonical, "property");
    setCanonical(canonical);
    setJsonLd({
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: siteName,
      url: window.location.origin,
      potentialAction: {
        "@type": "SearchAction",
        target: `${window.location.origin}/search?q={search_term_string}`,
        "query-input": "required name=search_term_string"
      }
    });
  }, [route, config]);
}

function setMeta(name: string, content: string, attribute: "name" | "property" = "name") {
  let element = document.head.querySelector<HTMLMetaElement>(`meta[${attribute}="${name}"]`);
  if (!element) {
    element = document.createElement("meta");
    element.setAttribute(attribute, name);
    document.head.appendChild(element);
  }
  element.content = content;
}

function setCanonical(href: string) {
  let element = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!element) {
    element = document.createElement("link");
    element.rel = "canonical";
    document.head.appendChild(element);
  }
  element.href = href;
}

function setJsonLd(data: Record<string, unknown>) {
  let element = document.getElementById("emergos-jsonld") as HTMLScriptElement | null;
  if (!element) {
    element = document.createElement("script");
    element.type = "application/ld+json";
    element.id = "emergos-jsonld";
    document.head.appendChild(element);
  }
  element.textContent = JSON.stringify(data);
}
