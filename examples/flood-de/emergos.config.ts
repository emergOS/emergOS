import { defineEmergOSConfig } from "../../apps/emergos-worker/emergos.config";

export default defineEmergOSConfig({
  disaster: {
    profile: "flood",
    country: "DE",
    defaultLocale: "de-DE",
    affectedAreaLabel: "Germany flood response"
  },
  modules: {
    missingPeople: true,
    foundPeople: true,
    tips: true,
    flyers: true,
    shelters: true,
    hospitals: false,
    aidCenters: true,
    missingPets: false,
    volunteers: true,
    emergencyContacts: true,
    maps: false,
    organizations: true,
    publicUpdates: true
  }
});
