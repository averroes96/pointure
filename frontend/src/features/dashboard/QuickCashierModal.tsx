import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useForm } from "react-hook-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { X, KeyRound, UserPlus, Eye, EyeOff, CheckCircle2, AlertCircle } from "lucide-react";
import api, { getApiError } from "@/lib/api";
import { isValidAlgerianPhone, normalizeAlgerianPhone } from "@/lib/phone";
import { cn } from "@/lib/utils";

interface QuickCashierFormData {
  first_name: string;
  last_name: string;
  phone: string;
  pin_code: string;
  password: string;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export default function QuickCashierModal({ isOpen, onClose, onSuccess }: Props) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [errorMsg, setErrorMsg] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<QuickCashierFormData>({
    defaultValues: {
      first_name: "",
      last_name: "",
      phone: "",
      pin_code: "",
      password: "Caisse@" + Math.floor(1000 + Math.random() * 9000),
    },
  });

  const mutation = useMutation({
    mutationFn: (data: QuickCashierFormData) => {
      const payload = {
        role: "cashier",
        first_name: data.first_name.trim(),
        last_name: data.last_name.trim(),
        phone: normalizeAlgerianPhone(data.phone.trim()),
        pin_code: data.pin_code.trim(),
        password: data.password,
        confirm_password: data.password,
      };
      return api.post("/core/users/", payload).then((r) => r.data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dashboard", "kpis"] });
      queryClient.invalidateQueries({ queryKey: ["settings", "users"] });
      reset();
      setErrorMsg("");
      onSuccess();
      onClose();
    },
    onError: (err) => {
      setErrorMsg(getApiError(err));
    },
  });

  if (!isOpen) return null;

  function onSubmit(data: QuickCashierFormData) {
    setErrorMsg("");
    mutation.mutate(data);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="relative w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-primary-50 dark:bg-primary-950/50 text-primary-600 dark:text-primary-400 flex items-center justify-center">
              <KeyRound size={18} />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                {t("dashboard.onboarding.cashier_modal_title", "Créer un profil caissier")}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t("dashboard.onboarding.cashier_modal_subtitle", "Code PIN rapide à 4 chiffres pour le verrouillage")}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit(onSubmit)} className="p-6 space-y-4">
          {errorMsg && (
            <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300 text-xs flex items-center gap-2">
              <AlertCircle size={15} className="shrink-0 text-rose-500" />
              <span>{errorMsg}</span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                {t("user.first_name", "Prénom")} <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                {...register("first_name", { required: true })}
                placeholder="Yacine"
                className="w-full px-3 py-2 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                {t("user.last_name", "Nom")} <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                {...register("last_name", { required: true })}
                placeholder="Benali"
                className="w-full px-3 py-2 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              {t("user.phone", "Téléphone mobile")} <span className="text-rose-500">*</span>
            </label>
            <input
              type="tel"
              {...register("phone", {
                required: true,
                validate: (v) => isValidAlgerianPhone(v) || t("setup.error_phone_invalid", "Numéro de téléphone algérien invalide"),
              })}
              placeholder="0555 12 34 56"
              className={cn(
                "w-full px-3 py-2 text-sm rounded-xl border bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500 font-mono",
                errors.phone ? "border-rose-300 dark:border-rose-700" : "border-slate-200 dark:border-slate-700"
              )}
            />
            {errors.phone && (
              <p className="text-2xs text-rose-600 dark:text-rose-400 mt-1">{errors.phone.message}</p>
            )}
          </div>

          {/* PIN code */}
          <div className="p-3.5 rounded-xl bg-amber-50/60 dark:bg-amber-950/20 border border-amber-200/80 dark:border-amber-900/60 space-y-1.5">
            <label className="block text-xs font-bold text-amber-900 dark:text-amber-200">
              {t("dashboard.onboarding.cashier_pin_label", "Code PIN de Caisse (4 chiffres)")} <span className="text-rose-500">*</span>
            </label>
            <input
              type="password"
              inputMode="numeric"
              maxLength={4}
              {...register("pin_code", {
                required: true,
                pattern: {
                  value: /^\d{4}$/,
                  message: t("dashboard.onboarding.cashier_pin_invalid", "Le code PIN doit comporter exactement 4 chiffres"),
                },
              })}
              placeholder="••••"
              className="w-full px-3.5 py-2 text-lg text-center tracking-widest font-mono font-bold rounded-lg border border-amber-300 dark:border-amber-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
            <p className="text-2xs text-amber-700 dark:text-amber-300 leading-tight">
              {t("dashboard.onboarding.cashier_pin_hint", "Permet au caissier de déverrouiller la caisse tactile rapidement sans retaper son mot de passe complet.")}
            </p>
            {errors.pin_code && (
              <p className="text-2xs text-rose-600 dark:text-rose-400 mt-1">{errors.pin_code.message}</p>
            )}
          </div>

          {/* Account Password */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              {t("login.password", "Mot de passe")} <span className="text-rose-500">*</span>
            </label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                {...register("password", { required: true, minLength: 8 })}
                className="w-full px-3 py-2 pr-10 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500 font-mono text-xs"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
              >
                {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
            <p className="text-2xs text-slate-400 mt-1">
              {t("dashboard.onboarding.cashier_password_hint", "Mot de passe de secours pour la connexion classique (min 8 caractères).")}
            </p>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors"
            >
              {t("common.cancel", "Annuler")}
            </button>
            <button
              type="submit"
              disabled={mutation.isPending}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-primary-600 hover:bg-primary-700 rounded-xl shadow-xs disabled:opacity-50 transition-colors"
            >
              {mutation.isPending ? (
                <span>{t("common.saving", "Enregistrement...")}</span>
              ) : (
                <>
                  <UserPlus size={15} />
                  <span>{t("dashboard.onboarding.cashier_submit_btn", "Créer le compte caissier")}</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

