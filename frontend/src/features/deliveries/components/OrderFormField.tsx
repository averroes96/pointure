import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

/** Label + control + translated error, for the delivery-order form. */
export default function OrderFormField({
  label, error, htmlFor, children, hint,
}: {
  label: string;
  error?: string;
  htmlFor?: string;
  children: ReactNode;
  hint?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div>
      <label className="form-label" htmlFor={htmlFor}>{label}</label>
      {children}
      {error ? (
        <p className="mt-1 text-xs text-red-600 dark:text-rose-400" role="alert">{t(error)}</p>
      ) : hint ? (
        <p className="mt-1 text-xs text-text-muted dark:text-slate-400">{hint}</p>
      ) : null}
    </div>
  );
}
