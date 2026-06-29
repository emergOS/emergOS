import { describe, expect, it } from "vitest";
import { moderationSuggestion, translationDraft } from "../index";

describe("AI suggestion fallbacks", () => {
  it("flags sensitive moderation language without auto-deciding", () => {
    const suggestion = moderationSuggestion("A child was reported deceased with a phone number", false);

    expect(suggestion.provider).toBe("heuristic");
    expect(suggestion.label).toBe("review_recommended");
    expect(suggestion.humanReviewRequired).toBe(true);
    expect(suggestion.riskFlags).toContain("death_related_language");
    expect(suggestion.riskFlags).toContain("minor_related");
  });

  it("creates review-only translation drafts", () => {
    const draft = translationDraft("Shelter is open", "es", false);

    expect(draft.locale).toBe("es");
    expect(draft.draft).toBe("Shelter is open");
    expect(draft.humanReviewRequired).toBe(true);
  });
});
