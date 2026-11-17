import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { formatMoney } from "../shipments";
import {
  codToCollectCents, expectedCodCents, fromCents, goodsTotalCents, toCents,
  type CourierQuote, type FormErrors, type OrderForm,
} from "../deliveryOrders";
import OrderFormField from "./OrderFormField";

interface Props {
  form: OrderForm;
  errors: FormErrors;
  onChange: (patch: Partial<OrderForm>) => void;
  quote: CourierQuote | undefined;
  quoteLoading: boolean;
  quoteFailed: boolean;
}

/**
 * Goods value, the delivery fee the customer pays (with the courier's quote), options,
 * and the cash to collect (DL2.6). Amounts here are a preview: the server recomputes them.
 */
export default function OrderAmounts({ form, errors, onChange, quote, quoteLoading, quoteFailed }: Props) {
  const { t } = useTranslation();
  const goods = goodsTotalCents(form.lines);
  const expected = expectedCodCents(form);
  const collect = codToCollectCents(form);
  const quoteDiffers = !!quote && toCents(quote.delivery_fee) !== toCents(form.shipping_fee);

  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-semibold text-text-primary mb-1">{t("delivery_orders.section.amounts")}</legend>

      <OrderFormField
        label={t("delivery_orders.field.shipping_fee")} error={errors.shipping_fee} htmlFor="do-fee"
        hint={quoteLoading ? (
          <span className="inline-flex items-center gap-1"><Loader2 size={12} className="animate-spin" aria-hidden />{t("delivery_orders.quote_loading")}</span>
        ) : quoteFailed ? t("delivery_orders.quote_unavailable") : quote ? (
          <span className="inline-flex flex-wrap items-center gap-2">
            {t("delivery_orders.quote", { fee: formatMoney(quote.delivery_fee) })}
            {quote.estimated_days != null && <span>· {t("delivery_orders.quote_days", { count: quote.estimated_days })}</span>}
            {quoteDiffers && (
              <button type="button" className="text-primary-600 dark:text-primary-400 underline focus-visible:ring-2 rounded"
                      onClick={() => onChange({ shipping_fee: quote.delivery_fee, quoted_fee: quote.delivery_fee })}>
                {t("delivery_orders.use_quote")}
              </button>
            )}
          </span>
        ) : undefined}
      >
        <input id="do-fee" className="form-input" inputMode="decimal" dir="ltr" value={form.shipping_fee}
               disabled={form.free_shipping} onChange={(e) => onChange({ shipping_fee: e.target.value })} />
      </OrderFormField>

      <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-text-primary">
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" className="rounded" checked={form.free_shipping}
                 onChange={(e) => onChange({ free_shipping: e.target.checked })} />
          {t("delivery_orders.field.free_shipping")}
        </label>
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" className="rounded" checked={form.open_package}
                 onChange={(e) => onChange({ open_package: e.target.checked })} />
          {t("delivery_orders.field.open_package")}
        </label>
      </div>

      <OrderFormField label={t("delivery_orders.field.note_to_driver")} htmlFor="do-driver-note">
        <input id="do-driver-note" className="form-input" maxLength={255} value={form.note_to_driver}
               onChange={(e) => onChange({ note_to_driver: e.target.value })} />
      </OrderFormField>

      <dl className="rounded-lg bg-bg-alt/60 dark:bg-slate-900 border border-border dark:border-slate-800 p-3 text-sm space-y-1.5">
        <div className="flex justify-between"><dt className="text-text-muted dark:text-slate-400">{t("delivery_orders.goods_total")}</dt><dd className="text-text-primary">{formatMoney(fromCents(goods))}</dd></div>
        <div className="flex justify-between"><dt className="text-text-muted dark:text-slate-400">{t("delivery_orders.expected_cod")}</dt><dd className="text-text-primary">{formatMoney(fromCents(expected))}</dd></div>
        <div className="flex items-center justify-between gap-3 pt-1.5 border-t border-border dark:border-slate-800">
          <dt><label htmlFor="do-cod" className="font-semibold text-text-primary">{t("delivery_orders.field.cod")}</label></dt>
          <dd className="w-40">
            <input id="do-cod" className="form-input text-end font-semibold" inputMode="numeric" dir="ltr"
                   placeholder={fromCents(expected)} value={form.cod_override}
                   onChange={(e) => onChange({ cod_override: e.target.value })} />
          </dd>
        </div>
        {errors.cod_override ? (
          <p className="text-xs text-red-600 dark:text-rose-400" role="alert">{t(errors.cod_override)}</p>
        ) : (
          <p className="text-xs text-text-muted dark:text-slate-400">
            {form.cod_override.trim() ? t("delivery_orders.cod_custom", { amount: formatMoney(fromCents(collect)) })
              : t("delivery_orders.cod_auto")}
          </p>
        )}
      </dl>
    </fieldset>
  );
}
