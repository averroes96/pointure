import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { useWilayas } from "@/hooks/useLocationData";
import { cn } from "@/lib/utils";
import { useCourierDesks, type CourierCommunes, type FormErrors, type OrderForm } from "../deliveryOrders";
import OrderFormField from "./OrderFormField";

interface Props {
  form: OrderForm;
  errors: FormErrors;
  onChange: (patch: Partial<OrderForm>) => void;
  accountId: string;
  communes: CourierCommunes | undefined;
  communesLoading: boolean;
}

/**
 * Wilaya (Pointure's 69), commune (the courier's own spelling, P2.2), address, and
 * home or stop desk (the courier's desks, P2.1).
 */
export default function OrderDestinationFields({ form, errors, onChange, accountId, communes, communesLoading }: Props) {
  const { t, i18n } = useTranslation();
  const arabic = i18n.language.startsWith("ar");
  const { data: wilayas = [] } = useWilayas();
  const stopdesk = form.delivery_type === "stopdesk";
  const desks = useCourierDesks(accountId, communes?.ship_wilaya, stopdesk);

  const names = communes?.courier_communes ?? [];
  const unknownCommune = !!form.commune && !!communes?.available && !names.some((c) => c.name_fr === form.commune);

  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-semibold text-text-primary mb-1">{t("delivery_orders.section.destination")}</legend>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <OrderFormField label={t("delivery_orders.field.wilaya")} error={errors.wilaya} htmlFor="do-wilaya">
          <select
            id="do-wilaya" className="form-input" value={form.wilaya}
            onChange={(e) => onChange({ wilaya: e.target.value, commune: "", stop_desk_id: "", stop_desk_name: "" })}
          >
            <option value="">{t("delivery_orders.choose")}</option>
            {wilayas.map((w) => (
              <option key={w.id} value={w.code}>{w.code} - {arabic && w.ar_name ? w.ar_name : w.name}</option>
            ))}
          </select>
        </OrderFormField>
        <OrderFormField
          label={t("delivery_orders.field.commune")}
          error={errors.commune ?? (unknownCommune ? "delivery_orders.errors.commune_unknown" : undefined)}
          htmlFor="do-commune"
          hint={communes && !communes.available ? (
            <span className="inline-flex items-center gap-1">
              <Loader2 size={12} className="animate-spin" aria-hidden /> {t("delivery_orders.communes_loading")}
            </span>
          ) : undefined}
        >
          <select
            id="do-commune" className="form-input" value={form.commune}
            disabled={!form.wilaya || communesLoading}
            onChange={(e) => onChange({ commune: e.target.value })}
          >
            <option value="">{t("delivery_orders.choose")}</option>
            {unknownCommune && <option value={form.commune}>{form.commune}</option>}
            {names.map((c) => (
              <option key={c.name_fr} value={c.name_fr}>
                {arabic && c.name_ar ? `${c.name_ar} (${c.name_fr})` : c.name_ar ? `${c.name_fr} (${c.name_ar})` : c.name_fr}
              </option>
            ))}
          </select>
        </OrderFormField>
      </div>
      <OrderFormField label={t("delivery_orders.field.address")} htmlFor="do-address">
        <input id="do-address" className="form-input" value={form.address}
               onChange={(e) => onChange({ address: e.target.value })} />
      </OrderFormField>

      <div role="radiogroup" aria-label={t("delivery_orders.field.delivery_type")} className="grid grid-cols-2 gap-2">
        {(["home", "stopdesk"] as const).map((type) => (
          <button
            key={type} type="button" role="radio" aria-checked={form.delivery_type === type}
            onClick={() => onChange(type === "home"
              ? { delivery_type: type, stop_desk_id: "", stop_desk_name: "" }
              : { delivery_type: type })}
            className={cn(
              "rounded-lg border px-3 py-2 text-sm font-medium transition-colors focus-visible:ring-2",
              form.delivery_type === type
                ? "border-primary-500 bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300"
                : "border-border text-text-secondary hover:bg-bg-alt dark:border-slate-800 dark:text-slate-400 dark:hover:bg-slate-800",
            )}
          >
            {t(`delivery_orders.${type}`)}
          </button>
        ))}
      </div>

      {stopdesk && (
        <OrderFormField label={t("delivery_orders.field.desk")} error={errors.stop_desk_id} htmlFor="do-desk"
                        hint={desks.isError ? t("delivery_orders.desks_unavailable") : undefined}>
          <select
            id="do-desk" className="form-input" value={form.stop_desk_id}
            disabled={!accountId || !communes?.ship_wilaya || desks.isLoading}
            onChange={(e) => {
              const desk = desks.data?.find((d) => d.id === e.target.value);
              onChange({ stop_desk_id: desk?.id ?? "", stop_desk_name: desk?.name ?? "" });
            }}
          >
            <option value="">{desks.isLoading ? t("common.loading") : t("delivery_orders.choose")}</option>
            {form.stop_desk_id && !desks.data?.some((d) => d.id === form.stop_desk_id) && (
              <option value={form.stop_desk_id}>{form.stop_desk_name || form.stop_desk_id}</option>
            )}
            {desks.data?.map((d) => (
              <option key={d.id} value={d.id}>{d.commune_name ? `${d.name} — ${d.commune_name}` : d.name}</option>
            ))}
          </select>
        </OrderFormField>
      )}
    </fieldset>
  );
}
