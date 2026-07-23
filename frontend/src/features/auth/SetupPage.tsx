import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Eye, EyeOff, ArrowRight, ArrowLeft, CheckCircle, Loader2 } from "lucide-react";
import api from "@/lib/api";
import { useWilayas } from "@/hooks/useLocationData";
import { cn } from "@/lib/utils";

// ── Types ───────────────────────────────────────────────────────────────────

interface FormState {
  business_name: string;
  wilaya: string;
  phone: string;
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
  const { data: wilayas } = useWilayas();

  const [step, setStep] = useState(1);
  const [form, setForm] = useState<FormState>({
    business_name: "",
    wilaya: "",
    phone: "",
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
  const [doneEmail, setDoneEmail] = useState("");
  const [globalError, setGlobalError] = useState("");

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
    if (!form.business_name.trim()) errs.business_name = "Le nom de la boutique est obligatoire.";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  // ── Step 2 validation ──────────────────────────────────────────────────────
  const validateStep2 = (): boolean => {
    const errs: Record<string, string> = {};
    if (!form.admin_email.trim() || !form.admin_email.includes("@"))
      errs.admin_email = "Adresse email invalide.";
    if (form.admin_password.length < 8)
      errs.admin_password = "Le mot de passe doit contenir au moins 8 caractères.";
    if (form.admin_password !== form.confirm_password)
      errs.confirm_password = "Les mots de passe ne correspondent pas.";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  // ── Navigation ─────────────────────────────────────────────────────────────
  const handleNext = () => {
    if (step === 1 && !validateStep1()) return;
    if (step === 2 && !validateStep2()) return;
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
        phone: form.phone.trim(),
        admin_email: form.admin_email.trim().toLowerCase(),
        admin_password: form.admin_password,
        confirm_password: form.confirm_password,
      };
      if (form.license_key.trim()) {
        payload.license_key = form.license_key.trim();
      }

      const response = await api.post("/setup/", payload);
      setDoneEmail(response.data.email ?? form.admin_email.trim().toLowerCase());
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
          // If it's a Step 1/2 field error, go back to the relevant step
          const fieldKeys = Object.keys(data as object);
          if (fieldKeys.some((k) => ["business_name"].includes(k))) setStep(1);
          else if (
            fieldKeys.some((k) =>
              ["admin_email", "admin_password", "confirm_password"].includes(k)
            )
          )
            setStep(2);
        } else if (data && typeof data === "object" && "error" in data) {
          setGlobalError((data as { error: string }).error);
        } else if (data && typeof data === "object" && "detail" in data) {
          setGlobalError((data as { detail: string }).detail);
        } else {
          setGlobalError("Une erreur inattendue s'est produite.");
        }
      } else {
        setGlobalError("Impossible de contacter le serveur. Vérifiez votre connexion.");
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
          <div className="inline-flex items-center justify-center w-16 h-16 bg-primary-500 rounded-2xl mb-4">
            <span className="text-3xl">👟</span>
          </div>
          <h1 className="text-2xl font-bold text-primary-500 mb-1">ShoeDZ</h1>

          <div className="card p-8 mt-6">
            <div className="flex justify-center mb-4">
              <CheckCircle size={48} className="text-success" strokeWidth={1.5} />
            </div>
            <h2 className="text-xl font-bold text-text-primary mb-2">
              Installation terminée !
            </h2>
            <p className="text-text-muted text-sm mb-1">
              Votre compte administrateur a été créé.
            </p>
            <p className="text-sm font-medium text-text-primary mb-6">
              {doneEmail}
            </p>
            <button
              onClick={() => navigate("/login", { replace: true })}
              className="btn-primary w-full justify-center py-2.5"
            >
              Connectez-vous maintenant
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
          <div className="inline-flex items-center justify-center w-16 h-16 bg-primary-500 rounded-2xl mb-4">
            <span className="text-3xl">👟</span>
          </div>
          <h1 className="text-2xl font-bold text-primary-500">ShoeDZ</h1>
          <p className="text-text-muted text-sm mt-1">Configuration initiale</p>
        </div>

        {/* Card */}
        <div className="card p-6">
          <StepDots current={step} total={3} />

          {/* ── Step 1: Business info ── */}
          {step === 1 && (
            <div>
              <h2 className="text-lg font-semibold text-text-primary mb-1">
                Votre boutique
              </h2>
              <p className="text-text-muted text-sm mb-5">
                Étape 1 / 3 — Informations sur votre commerce
              </p>

              <div className="space-y-4">
                {/* Business name */}
                <div>
                  <label className="form-label" htmlFor="business_name">
                    Nom de la boutique <span className="text-danger">*</span>
                  </label>
                  <input
                    id="business_name"
                    type="text"
                    value={form.business_name}
                    onChange={set("business_name")}
                    className={cn("form-input", errors.business_name && "border-danger focus:border-danger focus:ring-danger/30")}
                    placeholder="Ex : Maison de la Chaussure"
                    autoFocus
                  />
                  {errors.business_name && (
                    <p className="form-error">{errors.business_name}</p>
                  )}
                </div>

                {/* Wilaya */}
                <div>
                  <label className="form-label" htmlFor="wilaya">
                    Wilaya
                  </label>
                  <select
                    id="wilaya"
                    value={form.wilaya}
                    onChange={set("wilaya")}
                    className="form-input"
                  >
                    <option value="">— Sélectionner —</option>
                    {wilayas?.map((w) => (
                      <option key={w.code} value={w.code}>
                        {w.code} - {w.name} ({w.ar_name})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Phone */}
                <div>
                  <label className="form-label" htmlFor="phone">
                    Téléphone
                  </label>
                  <input
                    id="phone"
                    type="tel"
                    value={form.phone}
                    onChange={set("phone")}
                    className="form-input"
                    placeholder="Ex : 0555 12 34 56"
                  />
                </div>
              </div>

              <button
                type="button"
                onClick={handleNext}
                className="btn-primary w-full justify-center py-2.5 mt-6"
              >
                <span className="flex items-center gap-2">
                  Suivant
                  <ArrowRight size={16} />
                </span>
              </button>
            </div>
          )}

          {/* ── Step 2: Admin account ── */}
          {step === 2 && (
            <div>
              <h2 className="text-lg font-semibold text-text-primary mb-1">
                Compte administrateur
              </h2>
              <p className="text-text-muted text-sm mb-5">
                Étape 2 / 3 — Identifiants de connexion
              </p>

              <div className="space-y-4">
                {/* Email */}
                <div>
                  <label className="form-label" htmlFor="admin_email">
                    Email <span className="text-danger">*</span>
                  </label>
                  <input
                    id="admin_email"
                    type="email"
                    value={form.admin_email}
                    onChange={set("admin_email")}
                    className={cn("form-input", errors.admin_email && "border-danger focus:border-danger focus:ring-danger/30")}
                    placeholder="admin@votreboutique.dz"
                    autoFocus
                  />
                  {errors.admin_email && (
                    <p className="form-error">{errors.admin_email}</p>
                  )}
                </div>

                {/* Password */}
                <div>
                  <label className="form-label" htmlFor="admin_password">
                    Mot de passe <span className="text-danger">*</span>
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
                    Confirmer le mot de passe <span className="text-danger">*</span>
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
                    Retour
                  </span>
                </button>
                <button
                  type="button"
                  onClick={handleNext}
                  className="btn-primary flex-1 justify-center py-2.5"
                >
                  <span className="flex items-center gap-2">
                    Suivant
                    <ArrowRight size={16} />
                  </span>
                </button>
              </div>
            </div>
          )}

          {/* ── Step 3: License key ── */}
          {step === 3 && (
            <form onSubmit={handleSubmit}>
              <h2 className="text-lg font-semibold text-text-primary mb-1">
                Clé de licence
              </h2>
              <p className="text-text-muted text-sm mb-5">
                Étape 3 / 3 — Activation (optionnel)
              </p>

              <div className="space-y-4">
                <div>
                  <label className="form-label" htmlFor="license_key">
                    Clé de licence
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
                    Vous pouvez ignorer cette étape et activer la licence plus tard via la
                    ligne de commande.
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
                    Retour
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
                      Installation…
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      <CheckCircle size={16} />
                      Terminer l'installation
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
