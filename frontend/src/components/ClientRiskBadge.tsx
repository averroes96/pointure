import { useTranslation } from "react-i18next";
import { Lock, ShieldAlert, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ClientRiskDetails, ClientRiskGrade } from "@/types";

interface ClientRiskBadgeProps {
  grade?: ClientRiskGrade | string;
  isBlocked?: boolean;
  details?: ClientRiskDetails;
  compact?: boolean;
  className?: string;
}

export function ClientRiskBadge({
  grade,
  isBlocked,
  details,
  compact = false,
  className,
}: ClientRiskBadgeProps) {
  const { t } = useTranslation();

  const gradeKey = (grade || "A").toUpperCase() as ClientRiskGrade;

  // Grade color map
  const gradeStyles: Record<ClientRiskGrade, { bg: string; text: string; border: string }> = {
    A: {
      bg: "bg-emerald-50 dark:bg-emerald-950/40",
      text: "text-emerald-700 dark:text-emerald-300",
      border: "border-emerald-200 dark:border-emerald-800",
    },
    B: {
      bg: "bg-blue-50 dark:bg-blue-950/40",
      text: "text-blue-700 dark:text-blue-300",
      border: "border-blue-200 dark:border-blue-800",
    },
    C: {
      bg: "bg-amber-50 dark:bg-amber-950/40",
      text: "text-amber-700 dark:text-amber-300",
      border: "border-amber-200 dark:border-amber-800",
    },
    D: {
      bg: "bg-rose-50 dark:bg-rose-950/40",
      text: "text-rose-700 dark:text-rose-300",
      border: "border-rose-200 dark:border-rose-800",
    },
  };

  const style = gradeStyles[gradeKey] || gradeStyles.A;

  const titleText = details
    ? `${t(`risk.grade_${gradeKey.toLowerCase()}`)} · ${
        details.avg_days_to_pay !== null
          ? t("risk.avg_days_value", { days: details.avg_days_to_pay })
          : t("risk.no_settled_invoices")
      }${
        Number(details.overdue_amount) > 0
          ? ` · ${t("risk.overdue_amount", { amount: details.overdue_amount })} DZD`
          : ""
      }${
        details.bounced_cheques_12m > 0
          ? ` · ${t("risk.bounced_count", { count: details.bounced_cheques_12m })}`
          : ""
      }`
    : t(`risk.grade_${gradeKey.toLowerCase()}`);

  return (
    <div className={cn("inline-flex items-center gap-1.5", className)} title={titleText}>
      {isBlocked && (
        <span
          className={cn(
            "inline-flex items-center gap-1 font-semibold border rounded-full text-2xs uppercase tracking-wider",
            "bg-red-100 text-red-800 border-red-300 dark:bg-red-950/80 dark:text-red-200 dark:border-red-800",
            compact ? "px-1.5 py-0.5" : "px-2.5 py-0.5"
          )}
          title={t("risk.blocked_title")}
        >
          <Lock size={11} className="text-red-600 dark:text-red-400 shrink-0" />
          <span>{t("risk.blocked")}</span>
        </span>
      )}

      <span
        className={cn(
          "inline-flex items-center gap-1 font-bold border rounded-full text-2xs tabular-nums",
          style.bg,
          style.text,
          style.border,
          compact ? "px-2 py-0.5" : "px-2.5 py-0.5"
        )}
      >
        {gradeKey === "A" ? (
          <ShieldCheck size={11} className="shrink-0" />
        ) : gradeKey === "D" ? (
          <ShieldAlert size={11} className="shrink-0" />
        ) : (
          <span className="w-1.5 h-1.5 rounded-full bg-current shrink-0" />
        )}
        <span>{compact ? gradeKey : `${gradeKey} · ${t(`risk.grade_${gradeKey.toLowerCase()}`)}`}</span>
      </span>
    </div>
  );
}

