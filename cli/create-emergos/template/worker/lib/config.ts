import type { PublicConfig } from "../../src/lib/contracts";
import emergosConfig from "../../emergos.config";

export async function getPublicConfig(env: Env): Promise<PublicConfig> {
  const cached = await env.CONFIG_KV.get("public-config", "json").catch(() => null);
  if (cached && typeof cached === "object") {
    return cached as PublicConfig;
  }

  const crisisMode = await readCrisisMode(env);
  const modules = await readModules(env);
  const config: PublicConfig = {
    brand: {
      name: env.PUBLIC_SITE_NAME || emergosConfig.brand?.name || "emergOS",
      primaryColor: emergosConfig.brand?.primaryColor || "#C91525",
      backgroundColor: emergosConfig.brand?.backgroundColor || "#FFFFFF"
    },
    disaster: {
      profile: env.DISASTER_PROFILE || emergosConfig.disaster?.profile || "earthquake",
      country: env.COUNTRY_CODE || emergosConfig.disaster?.country || "VE",
      defaultLocale: env.DEFAULT_LOCALE || emergosConfig.disaster?.defaultLocale || "en",
      affectedAreaLabel: env.AFFECTED_AREA_LABEL || emergosConfig.disaster?.affectedAreaLabel || "Crisis response"
    },
    modules,
    map: {
      tileUrl: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      attribution: "&copy; OpenStreetMap contributors"
    },
    moderation: {
      publishMode: "hybrid",
      sensitiveStatusesRequireReview: true
    },
    contactDefaults: {
      mode: "protected_form",
      allowWhatsApp: true,
      requireExplicitPublicContactConsent: true
    },
    crisisMode,
    turnstileSiteKey: env.TURNSTILE_SITE_KEY || ""
  };

  await env.CONFIG_KV.put("public-config", JSON.stringify(config), { expirationTtl: 60 }).catch(() => undefined);
  return config;
}

const defaultModules: Record<string, boolean> = {
  missingPeople: true,
  foundPeople: true,
  tips: true,
  flyers: true,
  shelters: true,
  hospitals: true,
  aidCenters: true,
  missingPets: false,
  volunteers: false,
  emergencyContacts: true,
  maps: false,
  organizations: true,
  publicUpdates: true,
  privacyRequests: true,
  ...emergosConfig.modules
};

async function readModules(env: Env): Promise<Record<string, boolean>> {
  const row = await env.DB.prepare("SELECT value_json FROM runtime_settings WHERE key = 'modules'")
    .first<{ value_json: string }>()
    .catch(() => null);
  if (!row) return defaultModules;
  try {
    const parsed = JSON.parse(row.value_json) as Record<string, unknown>;
    const overrides = Object.fromEntries(Object.entries(parsed).filter(([, value]) => typeof value === "boolean")) as Record<string, boolean>;
    return { ...defaultModules, ...overrides };
  } catch {
    return defaultModules;
  }
}

async function readCrisisMode(env: Env): Promise<PublicConfig["crisisMode"]> {
  const fallback = {
    enabled: false,
    disableMaps: false,
    preferLists: false,
    imageLight: false
  };
  const row = await env.DB.prepare("SELECT value_json FROM runtime_settings WHERE key = 'crisis_mode'")
    .first<{ value_json: string }>()
    .catch(() => null);
  if (!row) return fallback;
  try {
    return { ...fallback, ...(JSON.parse(row.value_json) as Partial<typeof fallback>) };
  } catch {
    return fallback;
  }
}
