import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Eye,
  EyeOff,
  ArrowRight,
  ArrowLeft,
  CheckCircle,
  Loader2,
  Smartphone,
  ShoppingBag,
  Boxes,
  Layers,
  Sparkles,
} from "lucide-react";
import api from "@/lib/api";
import { useAuth } from "@/features/auth/AuthContext";
import { useWilayas } from "@/hooks/useLocationData";
import { WILAYA_ENTRIES } from "@/lib/wilayas";
import { cn } from "@/lib/utils";
import {
  isValidAlgerianPhone,
  normalizeAlgerianPhone,
  formatAlgerianPhoneDisplay,
} from "@/lib/phone";

// ── Types ───────────────────────────────────────────────────────────────────

export type BusinessMode = "retail" | "wholesale" | "mixed";

interface FormState {
  business_name: string;
  wilaya: string;
  address: string;
  phone: string;
  business_mode: BusinessMode;
  admin_phone: string;
  admin_email: string;
  admin_password: string;
  confirm_password: string;
  license_key: string;
}

// ── Step indicator ───────────────────────────────────────────────────────────

function StepDots({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center justify-center gap-2 mb-6">
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          className={cn(
            "h-2 rounded-full transition-all duration-200",
            i + 1 === current
              ? "w-6 bg-primary-500"
              : i + 1 < current
              ? "w-2 bg-primary-300"
              : "w-2 bg-border"
          )}
        />
      ))}
    </div>
  );
}

// ── Spinner helper ───────────────────────────────────────────────────────────

function Spinner() {
  return <Loader2 size={16} className="animate-spin" />;
}

// ── Main component ───────────────────────────────────────────────────────────

export default function SetupPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { setAuthSession } = useAuth();
  const { data: wilayas } = useWilayas();

  const wilayaOptions = (wilayas && wilayas.length > 0)
    ? wilayas.map((w) => ({
        code: w.code,
        label: `${w.code} - ${w.name}${w.ar_name ? ` (${w.ar_name})` : ""}`,
      }))
    : WILAYA_ENTRIES.map((w) => ({
        code: w.code,
        label: `${w.code} - ${w.name}`,
      }));

  const [step, setStep] = useState(1);
  const [form, setForm] = useState<FormState>({
    business_name: "",
    wilaya: "",
    address: "",
    phone: "",
    business_mode: "retail",
    admin_phone: "",
    admin_email: "",
    admin_password: "",
    confirm_password: "",
    license_key: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [countdown, setCountdown] = useState(3);
  const [donePhone, setDonePhone] = useState("");
  const [doneEmail, setDoneEmail] = useState("");
  const [globalError, setGlobalError] = useState("");

  // ── Auto redirect when done ───────────────────────────────────────────────
  useEffect(() => {
    if (!done) return;
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          navigate("/", { replace: true });
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [done, navigate]);

  // ── Redirect if setup is not needed ───────────────────────────────────────
  useEffect(() => {
    api
      .get("/setup/status/")
      .then((r) => {
        if (!r.data.needed) navigate("/login", { replace: true });
      })
      .catch(() => navigate("/login", { replace: true }));
  }, [navigate]);

  // ── Field helpers ──────────────────────────────────────────────────────────
  const set = (field: keyof FormState) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => {
    setForm((prev) => ({ ...prev, [field]: e.target.value }));
    setErrors((prev) => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  // ── Step 1 validation ──────────────────────────────────────────────────────
  const validateStep1 = (): boolean => {
    const errs: Record<string, string> = {};
    if (!form.business_name.trim()) {
      errs.business_name = t("setup.business_name_required", "Le nom de la boutique est obligatoire.");
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  // ── Step 3 validation ──────────────────────────────────────────────────────
  const validateStep3 = (): boolean => {
    const errs: Record<string, string> = {};
    const adminPhone = form.admin_phone.trim();
    if (!adminPhone) {
      errs.admin_phone = t("setup.phone_required", "Le numéro de téléphone est obligatoire.");
    } else if (!isValidAlgerianPhone(adminPhone)) {
      errs.admin_phone = t(
        "setup.phone_invalid",
        "Numéro de téléphone algérien invalide (ex: 0555 12 34 56 ou +213 555 12 34 56)."
      );
    }

    if (form.admin_email.trim()) {
      if (!form.admin_email.includes("@") || !form.admin_email.includes(".")) {
        errs.admin_email = t("setup.email_invalid", "Format d'adresse email invalide.");
      }
    }

    if (form.admin_password.length < 8)
      errs.admin_password = t("setup.password_min", "Le mot de passe doit contenir au moins 8 caractères.");
    if (form.admin_password !== form.confirm_password)
      errs.confirm_password = t("setup.password_mismatch", "Les mots de passe ne correspondent pas.");
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  // ── Navigation ─────────────────────────────────────────────────────────────
  const handleNext = () => {
    if (step === 1 && !validateStep1()) return;
    if (step === 3 && !validateStep3()) return;
    setStep((s) => s + 1);
  };

  const handleBack = () => {
    setErrors({});
    setStep((s) => s - 1);
  };

  // ── Final submission ───────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setGlobalError("");
    setIsLoading(true);

    try {
      const payload: Record<string, string> = {
        business_name: form.business_name.trim(),
        wilaya: form.wilaya,
        address: form.address.trim(),
        phone: form.phone.trim() || form.admin_phone.trim(),
        business_mode: form.business_mode,
        admin_phone: normalizeAlgerianPhone(form.admin_phone.trim()),
        admin_email: form.admin_email.trim().toLowerCase(),
        admin_password: form.admin_password,
        confirm_password: form.confirm_password,
      };
      if (form.license_key.trim()) {
        payload.license_key = form.license_key.trim();
      }

      const response = await api.post("/setup/", payload);
      setDonePhone(response.data.phone_display || formatAlgerianPhoneDisplay(response.data.phone || form.admin_phone));
      setDoneEmail(response.data.email || form.admin_email.trim().toLowerCase());

      // Auto-authenticate immediately with issued JWT tokens
      if (response.data.access && response.data.refresh) {
        try {
          await setAuthSession(response.data.access, response.data.refresh);
        } catch (authErr) {
          console.warn("Auto-login setAuthSession error:", authErr);
        }
      }

      setDone(true);
    } catch (err: unknown) {
      if (
        err &&
        typeof err === "object" &&
        "response" in err &&
        (err as { response?: { data?: unknown } }).response?.data
      ) {
        const data = (err as { response: { data: unknown } }).response.data;
        if (data && typeof data === "object" && !("detail" in data) && !("error" in data)) {
          // Field-level errors returned by the API
          setErrors(data as Record<string, string>);
          // If it's a Step 1/3 field error, go back to the relevant step
          const fieldKeys = Object.keys(data as object);
          if (fieldKeys.some((k) => ["business_name", "wilaya", "address", "phone"].includes(k))) setStep(1);
          else if (
            fieldKeys.some((k) =>
              ["admin_phone", "admin_email", "admin_password", "confirm_password"].includes(k)
            )
          )
            setStep(3);
        } else if (data && typeof data === "object" && "error" in data) {
          setGlobalError((data as { error: string }).error);
        } else if (data && typeof data === "object" && "detail" in data) {
          setGlobalError((data as { detail: string }).detail);
        } else {
          setGlobalError(t("setup.unexpected_error", "Une erreur inattendue s'est produite."));
        }
      } else {
        setGlobalError(t("setup.network_error", "Impossible de contacter le serveur. Vérifiez votre connexion."));
      }
    } finally {
      setIsLoading(false);
    }
  };

  // ── Success screen ─────────────────────────────────────────────────────────
  if (done) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center p-4">
        <div className="w-full max-w-md text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-primary-500 rounded-2xl mb-4 shadow-lg shadow-primary-500/20">
            <span className="text-3xl">👟</span>
          </div>
          <h1 className="text-2xl font-bold text-primary-500 mb-1">ShoeDZ</h1>

          <div className="card p-8 mt-6">
            <div className="flex justify-center mb-4">
              <CheckCircle size={48} className="text-emerald-500 dark:text-emerald-400" strokeWidth={1.5} />
            </div>
            <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-2">
              {t("setup.success_title", "Installation terminée !")}
            </h2>
            <p className="text-slate-500 dark:text-slate-400 text-sm mb-4">
              {t("setup.success_subtitle", "Votre boutique et votre compte administrateur sont prêts. Vous êtes automatiquement connecté.")}
            </p>

            <div className="bg-slate-50 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 rounded-xl p-4 mb-5 text-start">
              <div className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold mb-1">
                {t("setup.primary_identifier", "Identifiant de connexion principal")}
              </div>
              <div className="flex items-center gap-2 text-primary-600 dark:text-primary-400 font-mono font-bold text-lg">
                <Smartphone size={20} />
                <span>{donePhone}</span>
              </div>
              {doneEmail && (
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                  {t("setup.backup_email", "Email de secours :")}{" "}
                  <span className="font-medium text-slate-900 dark:text-white">{doneEmail}</span>
                </div>
              )}
            </div>

            <p className="text-xs text-slate-500 dark:text-slate-400 mb-4 animate-pulse">
              {countdown <= 1
                ? t("setup.redirecting_in", { count: countdown, defaultValue: `Redirection vers le tableau de bord dans ${countdown} seconde...` })
                : t("setup.redirecting_in_plural", { count: countdown, defaultValue: `Redirection vers le tableau de bord dans ${countdown} secondes...` })}
            </p>

            <button
              onClick={() => navigate("/", { replace: true })}
              className="btn-primary w-full justify-center py-2.5 font-semibold shadow-xs"
            >
              {t("setup.go_to_dashboard", "Accéder au tableau de bord")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Wizard ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-surface flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo & Title */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-primary-500 rounded-2xl mb-4 shadow-lg shadow-primary-500/20">
            <span className="text-3xl">👟</span>
          </div>
          <h1 className="text-2xl font-bold text-primary-500">ShoeDZ</h1>
          <p className="text-text-muted text-sm mt-1">{t("setup.title", "Configuration initiale")}</p>
        </div>

        {/* Card */}
        <div className="card p-6">
          <StepDots current={step} total={4} />

          {/* ── Step 1: Business info ── */}
          {step === 1 && (
            <div>
              <h2 className="text-lg font-semibold text-text-primary mb-1">
                {t("setup.step_1_title", "Votre boutique")}
              </h2>
              <p className="text-text-muted text-sm mb-5">
                {t("setup.step_1_subtitle", "Étape 1 / 4 — Informations sur votre commerce")}
              </p>

              <div className="space-y-4">
                {/* Business name */}
                <div>
                  <label className="form-label" htmlFor="business_name">
                    {t("setup.business_name", "Nom de la boutique")} <span className="text-danger">*</span>
                  </label>
                  <input
                    id="business_name"
                    type="text"
                    value={form.business_name}
                    onChange={set("business_name")}
                    className={cn("form-input", errors.business_name && "border-danger focus:border-danger focus:ring-danger/30")}
                    placeholder={t("setup.business_name_placeholder", "Ex : Maison de la Chaussure")}
                    autoFocus
                  />
                  {errors.business_name && (
                    <p className="form-error">{errors.business_name}</p>
                  )}
                </div>

                {/* Wilaya */}
                <div>
                  <label className="form-label" htmlFor="wilaya">
                    {t("setup.wilaya", "Wilaya")}
                  </label>
                  <select
                    id="wilaya"
                    value={form.wilaya}
                    onChange={set("wilaya")}
                    className="form-input"
                  >
                    <option value="">{t("setup.wilaya_placeholder", "— Sélectionner —")}</option>
                    {wilayaOptions.map((w) => (
                      <option key={w.code} value={w.code}>
                        {w.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Store Address */}
                <div>
                  <label className="form-label" htmlFor="address">
                    {t("setup.address", "Adresse de la boutique")}
                  </label>
                  <input
                    id="address"
                    type="text"
                    value={form.address}
                    onChange={set("address")}
                    className="form-input"
                    placeholder={t("setup.address_placeholder", "Ex : 12 Rue Didouche Mourad")}
                  />
                </div>

                {/* Store Phone */}
                <div>
                  <label className="form-label" htmlFor="phone">
                    {t("setup.store_phone", "Téléphone du magasin")}
                  </label>
                  <input
                    id="phone"
                    type="tel"
                    value={form.phone}
                    onChange={set("phone")}
                    className="form-input"
                    placeholder={t("setup.store_phone_placeholder", "Ex : 021 23 45 67 ou 0555 12 34 56")}
                  />
                </div>
              </div>

              <button
                type="button"
                onClick={handleNext}
                className="btn-primary w-full justify-center py-2.5 mt-6"
              >
                <span className="flex items-center gap-2">
                  {t("setup.next", "Suivant")}
                  <ArrowRight size={16} />
                </span>
              </button>
            </div>
          )}

          {/* ── Step 2: Store Mode Selection ── */}
          {step === 2 && (
            <div>
              <h2 className="text-lg font-semibold text-text-primary mb-1">
                {t("setup.step_2_title", "Mode d'activité")}
              </h2>
              <p className="text-text-muted text-sm mb-5">
                {t("setup.step_2_subtitle", "Étape 2 / 4 — Comment fonctionne votre commerce ?")}
              </p>

              <div className="space-y-3">
                {/* Retail option */}
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setForm((prev) => ({ ...prev, business_mode: "retail" }))}
                  className={cn(
                    "p-4 rounded-xl border text-start cursor-pointer transition-all",
                    form.business_mode === "retail"
                      ? "border-primary-500 bg-primary-50/40 dark:bg-primary-950/30 ring-2 ring-primary-500/20"
                      : "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 hover:border-slate-300 dark:hover:border-slate-700"
                  )}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={cn(
                        "p-2.5 rounded-xl shrink-0 transition-colors",
                        form.business_mode === "retail"
                          ? "bg-primary-500 text-white"
                          : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300"
                      )}
                    >
                      <ShoppingBag size={20} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-sm text-slate-900 dark:text-white">
                          {t("setup.mode_retail_title", "Boutique de détail")}
                        </span>
                        <span className="text-2xs font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                          {t("setup.mode_retail_badge", "Recommandé")}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                        {t("setup.mode_retail_desc", "Vente directe par paire au comptoir, caisse tactile rapide, tickets de caisse thermique (80mm/58mm).")}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Wholesale option */}
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setForm((prev) => ({ ...prev, business_mode: "wholesale" }))}
                  className={cn(
                    "p-4 rounded-xl border text-start cursor-pointer transition-all",
                    form.business_mode === "wholesale"
                      ? "border-primary-500 bg-primary-50/40 dark:bg-primary-950/30 ring-2 ring-primary-500/20"
                      : "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 hover:border-slate-300 dark:hover:border-slate-700"
                  )}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={cn(
                        "p-2.5 rounded-xl shrink-0 transition-colors",
                        form.business_mode === "wholesale"
                          ? "bg-primary-500 text-white"
                          : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300"
                      )}
                    >
                      <Boxes size={20} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="font-semibold text-sm text-slate-900 dark:text-white">
                        {t("setup.mode_wholesale_title", "Grossiste & Demi-gros")}
                      </span>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                        {t("setup.mode_wholesale_desc", "Vente par cartons complets, factures B2B, bons de livraison et gestion des soldes clients.")}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Mixed option */}
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setForm((prev) => ({ ...prev, business_mode: "mixed" }))}
                  className={cn(
                    "p-4 rounded-xl border text-start cursor-pointer transition-all",
                    form.business_mode === "mixed"
                      ? "border-primary-500 bg-primary-50/40 dark:bg-primary-950/30 ring-2 ring-primary-500/20"
                      : "border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 hover:border-slate-300 dark:hover:border-slate-700"
                  )}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={cn(
                        "p-2.5 rounded-xl shrink-0 transition-colors",
                        form.business_mode === "mixed"
                          ? "bg-primary-500 text-white"
                          : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300"
                      )}
                    >
                      <Layers size={20} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="font-semibold text-sm text-slate-900 dark:text-white">
                        {t("setup.mode_mixed_title", "Commerce Mixte (Détail + Gros)")}
                      </span>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                        {t("setup.mode_mixed_desc", "Active à la fois la caisse de détail au comptoir et la facturation par cartons.")}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  type="button"
                  onClick={handleBack}
                  className="btn-secondary flex-1 justify-center py-2.5"
                >
                  <span className="flex items-center gap-2">
                    <ArrowLeft size={16} />
                    {t("setup.back", "Retour")}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={handleNext}
                  className="btn-primary flex-1 justify-center py-2.5"
                >
                  <span className="flex items-center gap-2">
                    {t("setup.next", "Suivant")}
                    <ArrowRight size={16} />
                  </span>
                </button>
              </div>
            </div>
          )}

          {/* ── Step 3: Admin account ── */}
          {step === 3 && (
            <div>
              <h2 className="text-lg font-semibold text-text-primary mb-1">
                {t("setup.step_3_title", "Compte administrateur")}
              </h2>
              <p className="text-text-muted text-sm mb-5">
                {t("setup.step_3_subtitle", "Étape 3 / 4 — Identifiants de connexion")}
              </p>

              <div className="space-y-4">
                {/* Admin Phone */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="form-label mb-0" htmlFor="admin_phone">
                      {t("setup.admin_phone", "Téléphone de l'administrateur")} <span className="text-danger">*</span>
                    </label>
                    <span className="text-xs font-semibold px-2 py-0.5 rounded bg-primary-50 text-primary-700 dark:bg-primary-950 dark:text-primary-300 border border-primary-200 dark:border-primary-800">
                      🇩🇿 05 / 06 / 07 / 02
                    </span>
                  </div>
                  <input
                    id="admin_phone"
                    type="tel"
                    value={form.admin_phone}
                    onChange={set("admin_phone")}
                    className={cn(
                      "form-input",
                      errors.admin_phone && "border-danger focus:border-danger focus:ring-danger/30"
                    )}
                    placeholder="Ex : 0555 12 34 56 ou +213 555 12 34 56"
                    autoFocus
                  />
                  <p className="text-xs text-text-muted mt-1">
                    {t("setup.admin_phone_hint", "Votre identifiant principal pour vous connecter à ShoeDZ.")}
                  </p>
                  {errors.admin_phone && (
                    <p className="form-error">{errors.admin_phone}</p>
                  )}
                </div>

                {/* Email (Facultatif) */}
                <div>
                  <label className="form-label" htmlFor="admin_email">
                    {t("setup.email_optional", "Email (Facultatif)")}
                  </label>
                  <input
                    id="admin_email"
                    type="email"
                    value={form.admin_email}
                    onChange={set("admin_email")}
                    className={cn(
                      "form-input",
                      errors.admin_email && "border-danger focus:border-danger focus:ring-danger/30"
                    )}
                    placeholder="admin@votreboutique.dz"
                  />
                  <p className="text-xs text-text-muted mt-1">
                    {t("setup.email_hint", "Optionnel — pour recevoir les rapports d'activité et sauvegardes par email.")}
                  </p>
                  {errors.admin_email && (
                    <p className="form-error">{errors.admin_email}</p>
                  )}
                </div>

                {/* Password */}
                <div>
                  <label className="form-label" htmlFor="admin_password">
                    {t("setup.password", "Mot de passe")} <span className="text-danger">*</span>
                  </label>
                  <div className="relative">
                    <input
                      id="admin_password"
                      type={showPassword ? "text" : "password"}
                      value={form.admin_password}
                      onChange={set("admin_password")}
                      className={cn("form-input pe-10", errors.admin_password && "border-danger focus:border-danger focus:ring-danger/30")}
                      placeholder="••••••••"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute inset-y-0 end-0 pe-3 flex items-center text-text-muted hover:text-text-primary"
                      tabIndex={-1}
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  {errors.admin_password && (
                    <p className="form-error">{errors.admin_password}</p>
                  )}
                </div>

                {/* Confirm password */}
                <div>
                  <label className="form-label" htmlFor="confirm_password">
                    {t("setup.confirm_password", "Confirmer le mot de passe")} <span className="text-danger">*</span>
                  </label>
                  <div className="relative">
                    <input
                      id="confirm_password"
                      type={showConfirm ? "text" : "password"}
                      value={form.confirm_password}
                      onChange={set("confirm_password")}
                      className={cn("form-input pe-10", errors.confirm_password && "border-danger focus:border-danger focus:ring-danger/30")}
                      placeholder="••••••••"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirm((v) => !v)}
                      className="absolute inset-y-0 end-0 pe-3 flex items-center text-text-muted hover:text-text-primary"
                      tabIndex={-1}
                    >
                      {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  {errors.confirm_password && (
                    <p className="form-error">{errors.confirm_password}</p>
                  )}
                </div>
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  type="button"
                  onClick={handleBack}
                  className="btn-secondary flex-1 justify-center py-2.5"
                >
                  <span className="flex items-center gap-2">
                    <ArrowLeft size={16} />
                    {t("setup.back", "Retour")}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={handleNext}
                  className="btn-primary flex-1 justify-center py-2.5"
                >
                  <span className="flex items-center gap-2">
                    {t("setup.next", "Suivant")}
                    <ArrowRight size={16} />
                  </span>
                </button>
              </div>
            </div>
          )}

          {/* ── Step 4: License key ── */}
          {step === 4 && (
            <form onSubmit={handleSubmit}>
              <h2 className="text-lg font-semibold text-text-primary mb-1">
                {t("setup.step_4_title", "Clé de licence")}
              </h2>
              <p className="text-text-muted text-sm mb-5">
                {t("setup.step_4_subtitle", "Étape 4 / 4 — Activation (optionnel)")}
              </p>

              <div className="space-y-4">
                <div>
                  <label className="form-label" htmlFor="license_key">
                    {t("setup.license_key", "Clé de licence")}
                  </label>
                  <input
                    id="license_key"
                    type="text"
                    value={form.license_key}
                    onChange={set("license_key")}
                    className="form-input font-mono tracking-widest"
                    placeholder="SHDZ-XXXX-XXXX-XXXX"
                    autoFocus
                  />
                  <p className="text-xs text-text-muted mt-1.5">
                    {t("setup.license_key_hint", "Vous pouvez ignorer cette étape et activer la licence plus tard via la ligne de commande.")}
                  </p>
                </div>

                {/* Global error */}
                {globalError && (
                  <div className="bg-danger-light text-danger text-sm px-3 py-2 rounded-md">
                    {globalError}
                  </div>
                )}
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  type="button"
                  onClick={handleBack}
                  disabled={isLoading}
                  className="btn-secondary flex-1 justify-center py-2.5"
                >
                  <span className="flex items-center gap-2">
                    <ArrowLeft size={16} />
                    {t("setup.back", "Retour")}
                  </span>
                </button>
                <button
                  type="submit"
                  disabled={isLoading}
                  className="btn-primary flex-1 justify-center py-2.5"
                >
                  {isLoading ? (
                    <span className="flex items-center gap-2">
                      <Spinner />
                      {t("setup.installing", "Installation…")}
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      <CheckCircle size={16} />
                      {t("setup.install_button", "Terminer l'installation")}
                    </span>
                  )}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
