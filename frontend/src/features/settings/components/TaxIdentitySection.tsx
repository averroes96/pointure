import { useTranslation } from "react-i18next";
import { FileText } from "lucide-react";
import type { UseFormRegisterReturn } from "react-hook-form";

type BusinessTaxIdentityFields = {
  nif: UseFormRegisterReturn;
  rc: UseFormRegisterReturn;
  ai: UseFormRegisterReturn;
  nis: UseFormRegisterReturn;
};

type TaxIdentitySectionProps =
  | { variant: "business"; fields: BusinessTaxIdentityFields }
  | {
      variant: "invoice";
      taxRegimeField: UseFormRegisterReturn;
      legalMentionsField: UseFormRegisterReturn;
    };

export function TaxIdentitySection(props: TaxIdentitySectionProps) {
  const { t } = useTranslation();

  if (props.variant === "business") {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
            {t("settings.nif")}
          </label>
          <input
            type="text"
            {...props.fields.nif}
            className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:border-primary-500 focus:outline-none focus:ring-4 focus:ring-primary-500/10 transition-all font-mono"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
            {t("settings.rc")}
          </label>
          <input
            type="text"
            {...props.fields.rc}
            className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:border-primary-500 focus:outline-none focus:ring-4 focus:ring-primary-500/10 transition-all font-mono"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
            {t("settings.ai")}
          </label>
          <input
            type="text"
            {...props.fields.ai}
            className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:border-primary-500 focus:outline-none focus:ring-4 focus:ring-primary-500/10 transition-all font-mono"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
            {t("settings.nis", "NIS")}
          </label>
          <input
            type="text"
            {...props.fields.nis}
            className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:border-primary-500 focus:outline-none focus:ring-4 focus:ring-primary-500/10 transition-all font-mono"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="pt-6 border-t border-slate-200/80 dark:border-slate-800 space-y-4">
      <div>
        <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
          <FileText size={16} className="text-primary-600" />
          {t("settings.tax_regime_title", "Régime fiscal & Facturation")}
        </h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          {t("settings.tax_regime_desc", "Configurez le régime d'imposition de votre entreprise et les mentions légales à faire figurer sur les factures émises.")}
        </p>
      </div>

      <div className="p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/90 space-y-4">
        <div>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
            {t("settings.tax_regime_label", "Régime fiscal")}
          </label>
          <select
            {...props.taxRegimeField}
            className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3.5 py-2 text-sm text-slate-900 dark:text-white focus:border-primary-500 focus:outline-none focus:ring-4 focus:ring-primary-500/10 transition-all font-medium"
          >
            <option value="reel">{t("settings.tax_regime_reel", "Régime du réel (TVA applicable par défaut)")}</option>
            <option value="ifu">{t("settings.tax_regime_ifu", "Impôt Forfaitaire Unique - IFU (Sans TVA par défaut)")}</option>
          </select>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {t("settings.tax_regime_help", "En régime IFU, la TVA est désactivée automatiquement par défaut sur les nouvelles factures et devis.")}
          </p>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1.5">
            {t("settings.invoice_legal_mentions_label", "Mentions légales sur factures")}
          </label>
          <textarea
            {...props.legalMentionsField}
            rows={3}
            placeholder={t("settings.invoice_legal_mentions_placeholder", "Saisissez les mentions légales fournies par votre comptable.")}
            className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3.5 py-2 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:border-primary-500 focus:outline-none focus:ring-4 focus:ring-primary-500/10 transition-all resize-none"
          />
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {t("settings.invoice_legal_mentions_help", "Texte libre imprimé en bas de vos factures et devis PDF. À vérifier avec votre comptable.")}
          </p>
        </div>
      </div>
    </div>
  );
}
