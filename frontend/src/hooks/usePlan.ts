/**
 * usePlan — read the current tenant's plan and check feature access.
 *
 * Mirror of backend PLAN_RANK in apps/core/plan_permissions.py.
 */
import type { Plan } from "@/types";
import { useAuth } from "@/features/auth/AuthContext";

export const PLAN_RANK: Record<string, number> = {
  free: 0,
  pro_retail: 1,
  pro_wholesale: 2,
  enterprise: 3,
};

export const PLAN_LABELS: Record<string, string> = {
  free: "Gratuit",
  pro_retail: "Pro Retail",
  pro_wholesale: "Pro Wholesale",
  enterprise: "Enterprise",
};

export interface UsePlanReturn {
  /** The tenant's current plan slug */
  plan: Plan;
  /** Human-readable label for the current plan */
  planLabel: string;
  /**
   * Returns true if the current tenant plan rank >= the required plan rank.
   * Always true for superusers (no tenant) to avoid blocking admin tooling.
   */
  canAccess: (minPlan: Plan) => boolean;
}

export function usePlan(): UsePlanReturn {
  const { user } = useAuth();
  const plan = (user?.tenant?.plan ?? "free") as Plan;
  const rank = PLAN_RANK[plan] ?? 0;

  const canAccess = (minPlan: Plan): boolean => {
    const required = PLAN_RANK[minPlan] ?? 0;
    return rank >= required;
  };

  return { plan, planLabel: PLAN_LABELS[plan] ?? plan, canAccess };
}
