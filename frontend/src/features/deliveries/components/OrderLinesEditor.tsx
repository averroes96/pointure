import { useTranslation } from "react-i18next";
import { Trash2 } from "lucide-react";
import { VariantSearchInput } from "@/components/ui/VariantSearchInput";
import type { Variant } from "@/types";
import { formatMoney } from "../shipments";
import { fromCents, lineSubtotalCents, newLineKey, type FormErrors, type FormLine } from "../deliveryOrders";

interface Props {
  lines: FormLine[];
  errors: FormErrors;
  onChange: (lines: FormLine[]) => void;
}

/** Articles from stock (P2.6). Adding the same article again adds one to its quantity. */
export default function OrderLinesEditor({ lines, errors, onChange }: Props) {
  const { t } = useTranslation();

  const add = (variant: Variant) => {
    const id = String(variant.id);
    const existing = lines.find((l) => l.variant === id);
    if (existing) {
      onChange(lines.map((l) => (l === existing ? { ...l, quantity: String((Number(l.quantity) || 0) + 1) } : l)));
      return;
    }
    const size = variant.size_eu > 0 ? ` ${variant.size_eu}` : "";
    const colour = variant.colour && !["N/A", "Standard", "Unique"].includes(variant.colour) ? ` ${variant.colour}` : "";
    onChange([...lines, {
      key: newLineKey(), variant: id, label: `${variant.product_name}${size}${colour}`, stock: variant.stock_qty,
      quantity: "1", unit_price: variant.product_sale_price || "0", discount_amount: "0",
    }]);
  };

  const update = (key: string, patch: Partial<FormLine>) =>
    onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-semibold text-text-primary mb-1">{t("delivery_orders.section.articles")}</legend>
      <VariantSearchInput value={null} onSelect={add} />
      {errors.lines && <p className="text-xs text-red-600 dark:text-rose-400" role="alert">{t(errors.lines)}</p>}
      {lines.length > 0 && (
        <ul className="divide-y divide-border dark:divide-slate-800 rounded-lg border border-border dark:border-slate-800">
          {lines.map((line) => {
            const error = errors[`line.${line.key}`];
            const lowStock = line.stock !== null && Number(line.quantity) > line.stock;
            return (
              <li key={line.key} className="p-2.5 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-text-primary">{line.label}</div>
                    {line.stock !== null && (
                      <div className={lowStock ? "text-xs text-amber-700 dark:text-amber-400" : "text-xs text-text-muted dark:text-slate-400"}>
                        {t("delivery_orders.in_stock", { count: line.stock })}
                      </div>
                    )}
                  </div>
                  <button type="button" onClick={() => onChange(lines.filter((l) => l.key !== line.key))}
                          className="p-1.5 rounded text-text-muted hover:text-red-600 hover:bg-red-50 dark:text-slate-400 dark:hover:bg-red-900/30 focus-visible:ring-2"
                          aria-label={t("delivery_orders.remove_line")}>
                    <Trash2 size={14} aria-hidden />
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <label className="text-xs text-text-muted dark:text-slate-400">
                    {t("delivery_orders.field.quantity")}
                    <input className="form-input mt-0.5 text-sm" type="number" min={1} max={999} inputMode="numeric"
                           value={line.quantity} onChange={(e) => update(line.key, { quantity: e.target.value })} />
                  </label>
                  <label className="text-xs text-text-muted dark:text-slate-400">
                    {t("delivery_orders.field.unit_price")}
                    <input className="form-input mt-0.5 text-sm" inputMode="decimal" dir="ltr"
                           value={line.unit_price} onChange={(e) => update(line.key, { unit_price: e.target.value })} />
                  </label>
                  <label className="text-xs text-text-muted dark:text-slate-400">
                    {t("delivery_orders.field.discount")}
                    <input className="form-input mt-0.5 text-sm" inputMode="decimal" dir="ltr"
                           value={line.discount_amount} onChange={(e) => update(line.key, { discount_amount: e.target.value })} />
                  </label>
                </div>
                <div className="flex items-center justify-between text-xs">
                  {error ? <span className="text-red-600 dark:text-rose-400" role="alert">{t(error)}</span> : <span />}
                  <span className="font-medium text-text-primary">{formatMoney(fromCents(lineSubtotalCents(line)))}</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </fieldset>
  );
}
