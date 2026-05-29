import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Eye, EyeOff, LogIn } from "lucide-react";
import { useAuth } from "./AuthContext";
import { getApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

export default function LoginPage() {
  const { t } = useTranslation();
  const { login } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      await login(email, password);
      navigate("/", { replace: true });
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
          <p className="text-text-muted text-sm mt-1">{t("auth.welcome")}</p>
        </div>

        {/* Form Card */}
        <div className="card p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Email */}
            <div>
              <label className="form-label" htmlFor="email">
                {t("auth.email")}
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="form-input"
                placeholder="admin@demo.com"
                required
                autoFocus
              />
            </div>

            {/* Password */}
            <div>
              <label className="form-label" htmlFor="password">
                {t("auth.password")}
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
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 end-0 pe-3 flex items-center text-text-muted hover:text-text-primary"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              <div className="flex justify-end mt-1">
                <Link to="/forgot-password" className="text-xs text-primary-500 hover:underline">
                  Mot de passe oublié ?
                </Link>
              </div>
            </div>

            {/* Error message */}
            {error && (
              <div className="bg-danger-light text-danger text-sm px-3 py-2 rounded-md">
                {error}
              </div>
            )}

            {/* Submit */}
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
                  {t("auth.signing_in")}
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <LogIn size={16} />
                  {t("auth.sign_in")}
                </span>
              )}
            </button>
          </form>
        </div>

        {/* Demo hint */}
        <p className="text-center text-xs text-text-muted mt-4">
          Demo: <code className="font-mono bg-surface px-1 py-0.5 rounded">admin@demo.com</code>{" "}
          / <code className="font-mono bg-surface px-1 py-0.5 rounded">demo1234</code>
        </p>
      </div>
    </div>
  );
}
