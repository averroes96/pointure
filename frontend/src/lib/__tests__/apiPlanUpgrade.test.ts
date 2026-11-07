import { describe, it, expect } from "vitest";
import { extractPlanUpgradeDetail, getApiError } from "../api";

describe("extractPlanUpgradeDetail", () => {
  it("detects wrapped DRF custom_exception_handler error shape and returns inner details", () => {
    const wrappedBody = {
      error: {
        code: "permission_denied",
        message: "{'error': 'plan_upgrade_required', ...}",
        details: {
          error: "plan_upgrade_required",
          required_plan: "pro_wholesale",
          current_plan: "pro_retail",
          upgrade_url: "/settings/billing",
        },
        status_code: 403,
      },
    };

    const result = extractPlanUpgradeDetail(wrappedBody);
    expect(result).not.toBeNull();
    expect(result?.required_plan).toBe("pro_wholesale");
    expect(result?.current_plan).toBe("pro_retail");
    expect(result?.upgrade_url).toBe("/settings/billing");
  });

  it("detects direct/legacy error shape", () => {
    const directBody = {
      error: "plan_upgrade_required",
      required_plan: "enterprise",
      current_plan: "free",
    };

    const result = extractPlanUpgradeDetail(directBody);
    expect(result).not.toBeNull();
    expect(result?.required_plan).toBe("enterprise");
    expect(result?.current_plan).toBe("free");
  });

  it("returns null for non-upgrade errors and standard permissions denied responses", () => {
    expect(extractPlanUpgradeDetail(null)).toBeNull();
    expect(extractPlanUpgradeDetail(undefined)).toBeNull();
    expect(extractPlanUpgradeDetail("string error")).toBeNull();
    expect(extractPlanUpgradeDetail({ error: "generic_forbidden" })).toBeNull();
    expect(
      extractPlanUpgradeDetail({
        error: {
          code: "permission_denied",
          message: "You do not have permission.",
          details: {},
        },
      })
    ).toBeNull();
  });
});

describe("getApiError", () => {
  it("extracts message string from DRF wrapped error shape { error: { code, message } }", () => {
    const error = {
      isAxiosError: true,
      response: {
        data: {
          error: {
            code: "has_transactions",
            message: "Ce produit ne peut pas être supprimé car il possède des transactions.",
            details: {},
            status_code: 400,
          },
        },
      },
    };

    const msg = getApiError(error);
    expect(typeof msg).toBe("string");
    expect(msg).toBe("Ce produit ne peut pas être supprimé car il possède des transactions.");
  });

  it("extracts detail string from standard DRF response { detail: '...' }", () => {
    const error = {
      isAxiosError: true,
      response: {
        data: {
          detail: "Introuvable.",
        },
      },
    };

    const msg = getApiError(error);
    expect(typeof msg).toBe("string");
    expect(msg).toBe("Introuvable.");
  });
});

