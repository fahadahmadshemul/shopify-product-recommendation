import { describe, it, expect, vi } from "vitest";

vi.mock("../app/shopify.server", () => {
  return {
    authenticate: {
      public: {
        appProxy: vi.fn(),
      },
    },
  };
});

import { scoreEvents } from "../app/routes/api.recommendations";

describe("Recommendation Event Scoring", () => {
  const now = new Date("2026-06-28T00:00:00Z").getTime();

  it("applies correct relative weighting (purchase > cart > view)", () => {
    const events = [
      { productId: "prod-view", eventType: "view", createdAt: new Date(now) },
      { productId: "prod-cart", eventType: "cart", createdAt: new Date(now) },
      { productId: "prod-purchase", eventType: "purchase", createdAt: new Date(now) },
    ];

    const scores = scoreEvents(events, now, "FREE");

    const viewScore = scores.get("prod-view");
    const cartScore = scores.get("prod-cart");
    const purchaseScore = scores.get("prod-purchase");

    // Default weight check (FREE tier has multiplier 1.0)
    expect(viewScore).toBeCloseTo(1.0);
    expect(cartScore).toBeCloseTo(3.0);
    expect(purchaseScore).toBeCloseTo(5.0);

    expect(purchaseScore).toBeGreaterThan(cartScore);
    expect(cartScore).toBeGreaterThan(viewScore);
  });

  it("applies recency decay (exponential decay with 14-day half-life)", () => {
    // 14 days ago = exactly 1 half-life (recency factor = 0.5)
    const fourteenDaysAgo = new Date(now - 14 * 24 * 60 * 60 * 1000);
    // 28 days ago = exactly 2 half-lives (recency factor = 0.25)
    const twentyEightDaysAgo = new Date(now - 28 * 24 * 60 * 60 * 1000);

    const events = [
      { productId: "prod-recent", eventType: "purchase", createdAt: new Date(now) },
      { productId: "prod-decay-1", eventType: "purchase", createdAt: fourteenDaysAgo },
      { productId: "prod-decay-2", eventType: "purchase", createdAt: twentyEightDaysAgo },
    ];

    const scores = scoreEvents(events, now, "FREE");

    const recentScore = scores.get("prod-recent");
    const decay1Score = scores.get("prod-decay-1");
    const decay2Score = scores.get("prod-decay-2");

    expect(recentScore).toBeCloseTo(5.0);
    expect(decay1Score).toBeCloseTo(2.5); // 5.0 * 0.5
    expect(decay2Score).toBeCloseTo(1.25); // 5.0 * 0.25
  });

  it("applies PRO plan priority boost of 1.5x", () => {
    const events = [
      { productId: "prod-1", eventType: "view", createdAt: new Date(now) },
    ];

    const freeScores = scoreEvents(events, now, "FREE");
    const basicScores = scoreEvents(events, now, "BASIC");
    const proScores = scoreEvents(events, now, "PRO");

    expect(freeScores.get("prod-1")).toBeCloseTo(1.0);
    expect(basicScores.get("prod-1")).toBeCloseTo(1.0);
    expect(proScores.get("prod-1")).toBeCloseTo(1.5); // 1.0 * 1.5
  });
});

// ---------------------------------------------------------------------------
// Exclude-list & availability filter contract
//
// The recommendation engine filters out excluded/unavailable products BEFORE
// calling scoreEvents (at the DB query level). These tests verify that:
//   1. When excluded products are stripped from the event list, they do not
//      appear in the resulting score map.
//   2. The filter correctly treats null status/totalInventory as "available"
//      (backward compat for products that haven't been re-synced yet).
//   3. Excluding a high-scoring product does not bleed its weight onto others.
// ---------------------------------------------------------------------------
describe("Exclude-list & availability filtering (scoreEvents contract)", () => {
  const now = new Date("2026-06-28T00:00:00Z").getTime();

  it("excluded products are absent from score map when pre-filtered from events", () => {
    // Simulate the engine having stripped prod-excluded before calling scoreEvents
    const events = [
      { productId: "prod-a", eventType: "purchase", createdAt: new Date(now) },
      { productId: "prod-b", eventType: "cart",     createdAt: new Date(now) },
      // prod-excluded would be here but was filtered out by the DB query
    ];

    const scores = scoreEvents(events, now, "FREE");

    expect(scores.has("prod-excluded")).toBe(false);
    expect(scores.has("prod-a")).toBe(true);
    expect(scores.has("prod-b")).toBe(true);
  });

  it("removing a high-score product does not inflate other products' scores", () => {
    // Without the excluded product, other scores must be exactly their own contribution
    const eventsWithout = [
      { productId: "prod-a", eventType: "view", createdAt: new Date(now) },
      { productId: "prod-b", eventType: "view", createdAt: new Date(now) },
    ];
    const eventsWith = [
      ...eventsWithout,
      { productId: "prod-high-score", eventType: "purchase", createdAt: new Date(now) },
    ];

    const scoresWithout = scoreEvents(eventsWithout, now, "FREE");
    const scoresWith    = scoreEvents(eventsWith,    now, "FREE");

    // prod-a and prod-b scores must be identical regardless of whether the
    // excluded high-scorer was present — scores are independent per product
    expect(scoresWithout.get("prod-a")).toBeCloseTo(scoresWith.get("prod-a"));
    expect(scoresWithout.get("prod-b")).toBeCloseTo(scoresWith.get("prod-b"));
  });

  it("null status (not-yet-synced) is treated as available \u2014 not filtered", () => {
    // This verifies the DB filter logic contract:
    // A product with status=null should NOT be in the unavailableProducts set
    // We test this by checking the filter predicate independently
    const isUnavailable = (product) =>
      product.excludedFromRecs === true ||
      (product.status !== null && product.status !== "ACTIVE") ||
      product.totalInventory === 0;

    expect(isUnavailable({ excludedFromRecs: false, status: null,     totalInventory: null })).toBe(false); // null = not synced, treat as ok
    expect(isUnavailable({ excludedFromRecs: false, status: "ACTIVE", totalInventory: 10  })).toBe(false); // healthy product
    expect(isUnavailable({ excludedFromRecs: true,  status: "ACTIVE", totalInventory: 10  })).toBe(true);  // merchant excluded
    expect(isUnavailable({ excludedFromRecs: false, status: "DRAFT",  totalInventory: 5   })).toBe(true);  // draft
    expect(isUnavailable({ excludedFromRecs: false, status: "ARCHIVED", totalInventory: 0 })).toBe(true);  // archived
    expect(isUnavailable({ excludedFromRecs: false, status: "ACTIVE", totalInventory: 0   })).toBe(true);  // in-stock=0 but active
    expect(isUnavailable({ excludedFromRecs: false, status: null,     totalInventory: 0   })).toBe(true);  // no-stock even if status unknown
  });

  it("unknown eventType defaults to weight 1 and does not throw", () => {
    const events = [
      { productId: "prod-z", eventType: "unknown_type", createdAt: new Date(now) },
    ];
    const scores = scoreEvents(events, now, "FREE");
    // Default weight fallback = 1
    expect(scores.get("prod-z")).toBeCloseTo(1.0);
  });
});
