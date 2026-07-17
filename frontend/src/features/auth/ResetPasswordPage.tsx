import { useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Eye, EyeOff, KeyRound } from "lucide-react";
import api, { getApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

export default function ResetPasswordPage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const uid = searchParams.get("uid");
  const token = searchParams.get("token");

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  // Redirect if required params are missing
  if (!uid || !token) {
    return <Navigate to="/login" replace />;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (password.length < 8) {
      setError(t("auth.password_too_short"));
      return;
    }
    if (password !== confirmPassword) {
      setError(t("auth.password_mismatch"));
      return;
    }

    setIsLoading(true);
    try {
      await api.post("/auth/password-reset/confirm/", {
        uid,
        token,
        new_password: password,
        confirm_password: confirmPassword,
      });
      setDone(true);
    } catch (err) {
      setError(getApiError(err));
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
          <p className="text-text-muted text-sm mt-1">{t("auth.new_password")}</p>
        </div>

        {/* Card */}
        <div className="card p-6">
          {done ? (
            <div className="space-y-4 text-center">
              <div className="inline-flex items-center justify-center w-12 h-12 bg-success-light rounded-full mx-auto">
                <KeyRound size={24} className="text-success" />
              </div>
              <p className="text-text-primary font-medium">{t("auth.password_reset_success")}</p>
              <p className="text-text-muted text-sm">
                {t("auth.password_reset_success_desc")}
              </p>
              <Link
                to="/login"
                className="inline-block text-sm text-primary-500 hover:underline mt-2"
              >
                {t("auth.sign_in")}
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <p className="text-text-muted text-sm">
                {t("auth.choose_new_password")}
              </p>

              {/* New password */}
              <div>
                <label className="form-label" htmlFor="password">
                  {t("auth.new_password")}
                </label>
                <div className="relative">
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className={cn("form-input pe-10")}
                    placeholder="••••••••"
                    required
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-y-0 end-0 pe-3 flex items-center text-text-muted hover:text-text-primary"
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              {/* Confirm password */}
              <div>
                <label className="form-label" htmlFor="confirmPassword">
                  {t("auth.confirm_password")}
                </label>
                <input
                  id="confirmPassword"
                  type={showPassword ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="form-input"
                  placeholder="••••••••"
                  required
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
                    {t("auth.resetting")}
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <KeyRound size={16} />
                    {t("auth.reset_password")}
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
