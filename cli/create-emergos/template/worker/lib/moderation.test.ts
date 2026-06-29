import { describe, expect, it } from "vitest";
import { assessReportRisk, moderationStatusForFlags } from "./moderation";

describe("moderation risk gates", () => {
  it("holds death-related and minor reports for review", () => {
    const flags = assessReportRisk({
      age: 12,
      ageRange: null,
      status: "missing",
      contactMode: "protected_form",
      publicContactConsent: false,
      text: "Child reported deceased by a neighbor",
      profile: "earthquake"
    });

    expect(flags).toContain("child_or_minor");
    expect(flags).toContain("death_related");
    expect(moderationStatusForFlags(flags)).toBe("pending_review");
  });

  it("publishes low-risk reports", () => {
    const flags = assessReportRisk({
      age: 34,
      ageRange: null,
      status: "missing",
      contactMode: "protected_form",
      publicContactConsent: false,
      text: "Last seen near the central plaza",
      profile: "earthquake"
    });

    expect(flags).toEqual([]);
    expect(moderationStatusForFlags(flags)).toBe("published");
  });
});
