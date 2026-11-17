import type { TFunction } from "i18next";
import type { CourierTestResult } from "./types";

/** Message and tone for a "Test connection" result. */
export function testResultMessage(
  t: TFunction,
  r: CourierTestResult,
): { tone: "success" | "warning" | "danger"; text: string } {
  switch (r.result) {
    case "ok":
      return r.limited
        ? { tone: "warning", text: t("deliveries.test_ok_limited") }
        : { tone: "success", text: t("deliveries.test_ok") };
    case "refused":
      return { tone: "danger", text: t("deliveries.test_refused") };
    case "forbidden":
      return { tone: "danger", text: t("deliveries.test_forbidden") };
    case "rate_limited":
      return { tone: "warning", text: t("deliveries.test_rate_limited", { seconds: r.retry_after }) };
    case "unreachable":
      return { tone: "warning", text: t("deliveries.test_unreachable") };
    case "not_supported":
      return { tone: "warning", text: t("deliveries.test_not_supported") };
    default:
      return { tone: "danger", text: t("deliveries.test_error") };
  }
}
