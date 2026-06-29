import { describe, expect, it } from "vitest";
import { resolveLocale, t } from "./i18n";

describe("locale resolution", () => {
  it("falls back regional Spanish to Spanish", () => {
    expect(resolveLocale("es-VE")).toBe("es");
    expect(t("es-VE", "reportMissing")).toBe("Reportar persona desaparecida");
  });

  it("falls back unknown locales to English", () => {
    expect(resolveLocale("uk-UA")).toBe("en");
    expect(t("uk-UA", "reportMissing")).toBe("Report missing person");
  });
});
