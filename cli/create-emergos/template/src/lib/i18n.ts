type Messages = Record<string, string>;

export const dictionaries: Record<string, Messages> = {
  en: {
    search: "Search name, city, shelter, hospital",
    reportMissing: "Report missing person",
    reportFound: "I found someone",
    submitTip: "Submit a tip",
    resources: "Shelters and resources",
    emergencyContacts: "Emergency contacts",
    missingPeople: "Missing people",
    foundPeople: "Found people",
    pets: "Missing and found pets",
    publicUpdates: "Public updates",
    printFlyer: "Print flyer",
    informationMayChange: "Information may change quickly. Verification labels do not mean every report is official.",
    publicContactConsent:
      "I understand this contact may appear online, on printed flyers, QR pages, and shared links.",
    protectedContact: "Use protected contact form",
    publicDirectContact: "Show public direct contact",
    organizationMediated: "Organization-mediated contact"
  },
  es: {
    search: "Buscar nombre, ciudad, refugio, hospital",
    reportMissing: "Reportar persona desaparecida",
    reportFound: "Encontré a alguien",
    submitTip: "Enviar información",
    resources: "Refugios y recursos",
    emergencyContacts: "Contactos de emergencia",
    missingPeople: "Personas desaparecidas",
    foundPeople: "Personas encontradas",
    pets: "Mascotas perdidas y encontradas",
    publicUpdates: "Actualizaciones públicas",
    printFlyer: "Imprimir volante",
    informationMayChange:
      "La información puede cambiar rápidamente. Las etiquetas de verificación no significan que todos los reportes sean oficiales.",
    publicContactConsent:
      "Entiendo que este contacto puede aparecer en línea, volantes impresos, páginas QR y enlaces compartidos.",
    protectedContact: "Usar formulario de contacto protegido",
    publicDirectContact: "Mostrar contacto público directo",
    organizationMediated: "Contacto mediado por organización"
  }
};

export function resolveLocale(locale: string | undefined, fallback = "en"): string {
  if (!locale) return fallback;
  if (dictionaries[locale]) return locale;
  const base = locale.split("-")[0];
  return dictionaries[base] ? base : fallback;
}

export function t(locale: string | undefined, key: string): string {
  const resolved = resolveLocale(locale);
  return dictionaries[resolved]?.[key] ?? dictionaries.en[key] ?? key;
}
