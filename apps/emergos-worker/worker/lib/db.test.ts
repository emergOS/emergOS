import { describe, expect, it } from "vitest";
import { rowToOrganization, rowToResource, rowToUpdate } from "./db";

describe("public row mappers", () => {
  it("maps public updates into API contracts", () => {
    expect(rowToUpdate({
      id: "upd_1",
      title: "Shelter update",
      body: "New capacity posted.",
      type: "shelter_update",
      source: "Civil defense",
      verification_level: "official_verified",
      locale: "en",
      pinned: 1,
      published_at: "2026-06-27T10:00:00.000Z"
    })).toEqual({
      id: "upd_1",
      title: "Shelter update",
      body: "New capacity posted.",
      type: "shelter_update",
      source: "Civil defense",
      verificationLevel: "official_verified",
      locale: "en",
      pinned: true,
      publishedAt: "2026-06-27T10:00:00.000Z"
    });
  });

  it("maps organizations into public-safe shape", () => {
    expect(rowToOrganization({
      id: "org_1",
      name: "Neighborhood Aid",
      type: "volunteer_group",
      description: "Local volunteers",
      website: "https://example.org",
      contact_public: "+1 555 0100",
      contact_private: "hidden",
      verification_status: "org_verified",
      updated_at: "2026-06-27T11:00:00.000Z"
    })).toEqual({
      id: "org_1",
      name: "Neighborhood Aid",
      type: "volunteer_group",
      description: "Local volunteers",
      website: "https://example.org",
      contactPublic: "+1 555 0100",
      verificationStatus: "org_verified",
      onboardingStatus: null,
      verificationEvidence: null,
      updatedAt: "2026-06-27T11:00:00.000Z"
    });
  });

  it("maps resource location precision for public map privacy checks", () => {
    expect(rowToResource({
      id: "res_1",
      type: "shelter",
      name: "Hidden shelter",
      availability_status: "open",
      verification_level: "contact_verified",
      lat: 10.5,
      lng: -66.9,
      location_precision: "hidden",
      last_verified_at: "2026-06-27T12:00:00.000Z",
      updated_at: "2026-06-27T12:00:00.000Z"
    }).locationPrecision).toBe("hidden");
  });
});
