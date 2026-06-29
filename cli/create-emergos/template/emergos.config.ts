export type DisasterProfile =
  | "earthquake"
  | "flood"
  | "hurricane"
  | "storm"
  | "wildfire"
  | "landslide"
  | "volcano"
  | "heatwave"
  | "coldwave"
  | "epidemic"
  | "conflict"
  | "displacement"
  | "industrial"
  | "infrastructure"
  | "multi";

export type EmergOSConfig = {
  brand?: {
    name?: string;
    primaryColor?: string;
    backgroundColor?: string;
  };
  disaster?: {
    profile?: DisasterProfile;
    country?: string;
    defaultLocale?: string;
    affectedAreaLabel?: string;
  };
  modules?: Partial<Record<string, boolean>>;
};

export function defineEmergOSConfig(config: EmergOSConfig): EmergOSConfig {
  return config;
}

export default defineEmergOSConfig({
  brand: {
    name: "emergOS",
    primaryColor: "#C91525",
    backgroundColor: "#FFFFFF"
  },
  disaster: {
    profile: "earthquake",
    country: "VE",
    defaultLocale: "en",
    affectedAreaLabel: "Crisis response"
  },
  modules: {
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
    maps: true,
    organizations: true,
    publicUpdates: true
  }
});
