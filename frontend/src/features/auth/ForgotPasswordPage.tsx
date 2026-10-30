import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Mail, Send, AlertTriangle, ArrowLeft } from "lucide-react";
import api, { getApiError } from "@/lib/api";
import { normalizeAlgerianPhone } from "@/lib/phone";

export default function ForgotPasswordPage() {
  const { t } = useTranslation();
  const [identifier, setIdentifier] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [noEmailNotice, setNoEmailNotice] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setNoEmailNotice(false);
    setIsLoading(true);

    try {
      const trimmed = identifier.trim();
      const cleanId = trimmed.includes("@")
        ? trimmed.toLowerCase()
        : normalizeAlgerianPhone(trimmed) || trimmed;

      await api.post("/auth/password-reset/", { identifier: cleanId });
      setSent(true);
    } catch (err: unknown) {
      if (err && typeof err === "object" && "response" in err) {
        const resp = (err as { response?: { data?: { error?: string; code?: string } } }).response;
        if (resp?.data?.code === "no_email" || resp?.data?.error?.includes("sans adresse email")) {
          setNoEmailNotice(true);
          setError(resp.data.error || t("auth.no_email_account_notice"));
          return;
        }
      }
      const msg = getApiError(err);
      if (!msg.includes("404") && !msg.includes("400")) {
        setError(msg);
      } else {
        setSent(true);
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo & Title */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-primary-500 rounded-2xl mb-4">
            <span className="text-3xl">👟</span>
          </div>
          <h1 className="text-2xl font-bold text-primary-500">ShoeDZ</h1>
          <p className="text-text-muted text-sm mt-1">{t("auth.forgot_password_title")}</p>
        </div>

        {/* Card */}
        <div className="card p-6">
          {sent ? (
            <div className="space-y-4 text-center">
              <div className="inline-flex items-center justify-center w-12 h-12 bg-success-light rounded-full mx-auto">
                <Mail size={24} className="text-success" />
              </div>
              <p className="text-text-primary font-medium">{t("auth.email_sent")}</p>
              <p className="text-text-muted text-sm">
                {t("auth.reset_link_sent_desc")}
              </p>
              <Link
                to="/login"
                className="inline-block text-sm text-primary-500 hover:underline mt-2"
              >
                {t("auth.back_to_login")}
              </Link>
            </div>
          ) : noEmailNotice ? (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200 space-y-2">
                <div className="flex items-center gap-2 font-bold text-sm">
                  <AlertTriangle size={18} className="text-amber-600 shrink-0" />
                  <span>Compte sans adresse email</span>
                </div>
                <p className="text-xs leading-relaxed text-amber-800 dark:text-amber-300">
                  {error || t("auth.no_email_account_notice")}
                </p>
              </div>

              <div className="flex flex-col gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setNoEmailNotice(false);
                    setError("");
                  }}
                  className="btn-secondary w-full justify-center py-2 text-xs"
                >
                  Essayer un autre identifiant
                </button>
                <Link
                  to="/login"
                  className="btn-primary w-full justify-center py-2.5 text-sm"
                >
                  <ArrowLeft size={16} className="me-1.5" />
                  {t("auth.back_to_login")}
                </Link>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <p className="text-text-muted text-sm">
                {t("auth.forgot_password_desc")}
              </p>

              <div>
                <label className="form-label" htmlFor="identifier">
                  {t("auth.phone_or_email")}
                </label>
                <input
                  id="identifier"
                  type="text"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  className="form-input"
                  placeholder={t("auth.email_placeholder")}
                  required
                  autoFocus
                />
              </div>

              {error && (
                <div className="bg-danger-light text-danger text-sm px-3 py-2 rounded-md">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={isLoading}
                className="btn-primary w-full justify-center py-2.5"
              >
                {isLoading ? (
                  <span className="flex items-center gap-2">
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    {t("auth.sending")}
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <Send size={16} />
                    {t("auth.send_link")}
                  </span>
                )}
              </button>

              <div className="text-center">
                <Link to="/login" className="text-xs text-text-muted hover:text-primary-500 hover:underline">
                  {t("auth.back_to_login")}
                </Link>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
