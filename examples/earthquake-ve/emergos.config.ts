import { defineEmergOSConfig } from "../../apps/emergos-worker/emergos.config";

export default defineEmergOSConfig({
  disaster: {
    profile: "earthquake",
    country: "VE",
    defaultLocale: "es-VE",
    affectedAreaLabel: "Venezuela"
  },
  modules: {
    missingPeople: true,
    foundPeople: true,
    tips: true,
    flyers: true,
    shelters: true,
    hospitals: true,
    aidCenters: true,
    missingPets: true,
    volunteers: true,
    emergencyContacts: true,
    maps: true,
    organizations: true,
    publicUpdates: true
  }
});
