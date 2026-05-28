/**
 * PlanGate — declarative plan-based feature gating.
 *
 * Usage:
 *   // Render children only on pro_wholesale+:
 *   <PlanGate min="pro_wholesale">
 *     <CreateInvoiceButton />
 *   </PlanGate>
 *
 *   // With a custom fallback:
 *   <PlanGate min="pro_retail" fallback={<PlanLock min="pro_retail" />}>
 *     <MarginToggle />
 *   </PlanGate>
 */
import type { ReactNode } from "react";
import { Lock } from "lucide-react";
import type { Plan } from "@/types";
import { usePlan, PLAN_LABELS } from "@/hooks/usePlan";

// ── Gate component ──────────────────────────────────────────────────────────

interface PlanGateProps {
  /** Minimum plan required to render children */
  min: Plan;
  children: ReactNode;
  /**
   * Rendered when plan is insufficient.
   * Defaults to null (nothing shown). Pass `<PlanLock min={min} />` to show a badge.
   */
  fallback?: ReactNode;
}

export function PlanGate({ min, children, fallback = null }: PlanGateProps) {
  const { canAccess } = usePlan();
  return canAccess(min) ? <>{children}</> : <>{fallback}</>;
}

// ── Lock badge ──────────────────────────────────────────────────────────────

interface PlanLockProps {
  /** The plan required to unlock this feature */
  min: Plan;
  /** Show the label inline (default true) */
  showLabel?: boolean;
}

/**
 * Small inline badge displayed when a feature is locked behind a plan upgrade.
 * Use as the `fallback` prop of <PlanGate> or anywhere you want to surface
 * plan-upgrade intent to the user.
 */
export function PlanLock({ min, showLabel = true }: PlanLockProps) {
  return (
    <span
      className="inline-flex items-center gap-1 text-2xs font-medium text-text-muted bg-surface-raised px-2 py-0.5 rounded-full border border-border select-none"
      title={`Disponible à partir du plan ${PLAN_LABELS[min] ?? min}`}
    >
      <Lock size={9} strokeWidth={2.5} />
      {showLabel && (PLAN_LABELS[min] ?? min)}
    </span>
  );
}

// ── Upgrade banner ──────────────────────────────────────────────────────────

interface UpgradeBannerProps {
  /** The plan required to use this page/section */
  min: Plan;
  /** Optional description of what will unlock */
  feature?: string;
}

/**
 * Full-width soft banner shown at the top of a page that is available but
 * requires a plan upgrade to use. The user can still see the UI but an
 * informational nudge is shown.
 */
export function UpgradeBanner({ min, feature }: UpgradeBannerProps) {
  const { canAccess } = usePlan();
  if (canAccess(min)) return null;

  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-warning-light border border-warning text-sm text-warning">
      <Lock size={15} className="flex-shrink-0" />
      <span>
        {feature
          ? `${feature} est disponible`
          : "Cette fonctionnalité est disponible"}{" "}
        à partir du plan{" "}
        <span className="font-semibold">{PLAN_LABELS[min] ?? min}</span>.
        Votre plan actuel ne permet pas d&apos;utiliser cette fonctionnalité.
      </span>
    </div>
  );
}
