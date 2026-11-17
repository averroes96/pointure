import { useTranslation } from "react-i18next";
import type { FormErrors, OrderForm } from "../deliveryOrders";
import OrderFormField from "./OrderFormField";

interface Props {
  form: OrderForm;
  errors: FormErrors;
  onChange: (patch: Partial<OrderForm>) => void;
}

export default function OrderCustomerFields({ form, errors, onChange }: Props) {
  const { t } = useTranslation();
  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-semibold text-text-primary mb-1">{t("delivery_orders.section.customer")}</legend>
      <OrderFormField label={t("delivery_orders.field.name")} error={errors.customer_name} htmlFor="do-name">
        <input id="do-name" className="form-input" value={form.customer_name} maxLength={200}
               onChange={(e) => onChange({ customer_name: e.target.value })} />
      </OrderFormField>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <OrderFormField label={t("delivery_orders.field.phone")} error={errors.customer_phone} htmlFor="do-phone">
          <input id="do-phone" className="form-input" dir="ltr" inputMode="tel" value={form.customer_phone}
                 maxLength={20} onChange={(e) => onChange({ customer_phone: e.target.value })} />
        </OrderFormField>
        <OrderFormField label={t("delivery_orders.field.phone2")} error={errors.customer_phone2} htmlFor="do-phone2">
          <input id="do-phone2" className="form-input" dir="ltr" inputMode="tel" value={form.customer_phone2}
                 maxLength={20} onChange={(e) => onChange({ customer_phone2: e.target.value })} />
        </OrderFormField>
      </div>
      <OrderFormField label={t("delivery_orders.field.notes")} htmlFor="do-notes">
        <textarea id="do-notes" className="form-input" rows={2} value={form.customer_notes}
                  onChange={(e) => onChange({ customer_notes: e.target.value })} />
      </OrderFormField>
    </fieldset>
  );
}
