import { useTranslation } from "react-i18next";
import { formatDZD } from "@/lib/api";
import type { SummaryCards } from "../shipments";

export type CardKey = "in_progress" | "follow_up" | "held" | "ready" | "paid" | "returned";

interface Props {
  cards: SummaryCards;
  active: CardKey | null;
  onSelect: (key: CardKey | null) => void;
}

/** Clickable totals; a click filters the table (click again to clear). */
export default function ShipmentSummaryCards({ cards, active, onSelect }: Props) {
  const { t, i18n } = useTranslation();
  const items: { key: CardKey; label: string; value: string; sub?: string }[] = [
    { key: "in_progress", label: t("deliveries.card_in_progress"), value: String(cards.inProgress) },
    { key: "follow_up", label: t("deliveries.card_follow_up"), value: String(cards.followUp),
      sub: t("deliveries.card_follow_up_hint") },
    { key: "held", label: t("deliveries.card_held"), value: formatDZD(cards.held.amount, i18n.language),
      sub: t("deliveries.card_parcels", { count: cards.held.count }) },
    { key: "ready", label: t("deliveries.card_ready"), value: formatDZD(cards.ready.amount, i18n.language),
      sub: t("deliveries.card_parcels", { count: cards.ready.count }) },
    { key: "paid", label: t("deliveries.card_paid"), value: formatDZD(cards.paid.amount, i18n.language),
      sub: t("deliveries.card_parcels", { count: cards.paid.count }) },
    { key: "returned", label: t("deliveries.card_returned"), value: String(cards.returned) },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          aria-pressed={active === item.key}
          onClick={() => onSelect(active === item.key ? null : item.key)}
          className={
            "kpi-card text-start cursor-pointer transition-all focus-visible:ring-2 focus-visible:ring-primary-500 " +
            (active === item.key ? "ring-2 ring-primary-500" : "hover:border-slate-300 dark:hover:border-slate-700")
          }
        >
          <span className="kpi-card__label">{item.label}</span>
          <span className="kpi-card__value">{item.value}</span>
          {item.sub && <span className="text-xs text-slate-500 dark:text-slate-400">{item.sub}</span>}
        </button>
      ))}
    </div>
  );
}
