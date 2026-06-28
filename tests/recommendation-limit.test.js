import { describe, it, expect, vi, beforeEach } from "vitest";
import { checkRecommendationLimit } from "../app/services/recommendation-limit.service";
import db from "../app/db.server";
import { resolveActivePlan } from "../app/services/billing.service";

// Mock the Prisma DB client
vi.mock("../app/db.server", () => {
  return {
    default: {
      recommendation: {
        count: vi.fn(),
      },
    },
  };
});

// Mock resolveActivePlan from billing.service
vi.mock("../app/services/billing.service", () => {
  const FREE_PLAN = { key: "FREE", name: "Free", limits: { recommendations: 100 } };
  const BASIC_PLAN = { key: "BASIC", name: "Basic", limits: { recommendations: 5000 } };
  const PRO_PLAN = { key: "PRO", name: "Pro", limits: { recommendations: null } };

  return {
    resolveActivePlan: vi.fn(),
    BILLING_PLAN_KEYS: { FREE: "FREE", BASIC: "BASIC", PRO: "PRO" },
    BILLING_PLANS: { FREE: FREE_PLAN, BASIC: BASIC_PLAN, PRO: PRO_PLAN },
  };
});

describe("checkRecommendationLimit", () => {
  const shopDomain = "test-shop.myshopify.com";

  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("FREE Plan Tier (Limit: 100)", () => {
    beforeEach(() => {
      resolveActivePlan.mockResolvedValue({
        planKey: "FREE",
        plan: { key: "FREE", name: "Free", limits: { recommendations: 100 } },
      });
    });

    it("allows recommendations when usage is strictly under the limit", async () => {
      db.recommendation.count.mockResolvedValue(99);

      const result = await checkRecommendationLimit(shopDomain);

      expect(result.allowed).toBe(true);
      expect(result.used).toBe(99);
      expect(result.remaining).toBe(1);
      expect(result.limit).toBe(100);
      expect(result.planName).toBe("Free");
    });

    it("disallows recommendations when usage is exactly at the limit", async () => {
      db.recommendation.count.mockResolvedValue(100);

      const result = await checkRecommendationLimit(shopDomain);

      expect(result.allowed).toBe(false);
      expect(result.used).toBe(100);
      expect(result.remaining).toBe(0);
    });

    it("disallows recommendations when usage is over the limit", async () => {
      db.recommendation.count.mockResolvedValue(105);

      const result = await checkRecommendationLimit(shopDomain);

      expect(result.allowed).toBe(false);
      expect(result.used).toBe(105);
      expect(result.remaining).toBe(0);
    });
  });

  describe("BASIC Plan Tier (Limit: 5000)", () => {
    beforeEach(() => {
      resolveActivePlan.mockResolvedValue({
        planKey: "BASIC",
        plan: { key: "BASIC", name: "Basic", limits: { recommendations: 5000 } },
      });
    });

    it("allows recommendations when usage is under basic limit", async () => {
      db.recommendation.count.mockResolvedValue(4999);

      const result = await checkRecommendationLimit(shopDomain);

      expect(result.allowed).toBe(true);
      expect(result.used).toBe(4999);
      expect(result.remaining).toBe(1);
    });

    it("disallows recommendations when usage is at basic limit", async () => {
      db.recommendation.count.mockResolvedValue(5000);

      const result = await checkRecommendationLimit(shopDomain);

      expect(result.allowed).toBe(false);
      expect(result.used).toBe(5000);
      expect(result.remaining).toBe(0);
    });
  });

  describe("PRO Plan Tier (Limit: Unlimited/null)", () => {
    beforeEach(() => {
      resolveActivePlan.mockResolvedValue({
        planKey: "PRO",
        plan: { key: "PRO", name: "Pro", limits: { recommendations: null } },
      });
    });

    it("always allows recommendations and returns Infinity remaining regardless of usage", async () => {
      db.recommendation.count.mockResolvedValue(999999);

      const result = await checkRecommendationLimit(shopDomain);

      expect(result.allowed).toBe(true);
      expect(result.limit).toBeNull();
      expect(result.used).toBe(999999);
      expect(result.remaining).toBe(Infinity);
      expect(result.planName).toBe("Pro");
    });
  });
});
