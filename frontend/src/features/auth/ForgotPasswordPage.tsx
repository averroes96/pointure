import { useState } from "react";
import { Link } from "react-router-dom";
import { Mail, Send } from "lucide-react";
import api, { getApiError } from "@/lib/api";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      await api.post("/auth/password-reset/", { email });
    } catch (err) {
      // Silently swallow — we always show the same success message
      // to avoid leaking user existence. Only surface unexpected errors.
      const msg = getApiError(err);
      // If it's a network error (no response), let the user know
      if (!msg.includes("404") && !msg.includes("400")) {
        // network-level failure
      }
    } finally {
      setIsLoading(false);
      setSent(true);
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
          <p className="text-text-muted text-sm mt-1">Réinitialisation du mot de passe</p>
        </div>

        {/* Card */}
        <div className="card p-6">
          {sent ? (
            <div className="space-y-4 text-center">
              <div className="inline-flex items-center justify-center w-12 h-12 bg-success-light rounded-full mx-auto">
                <Mail size={24} className="text-success" />
              </div>
              <p className="text-text-primary font-medium">Email envoyé !</p>
              <p className="text-text-muted text-sm">
                Vérifiez votre boîte mail — si un compte existe pour cet email,
                vous recevrez un lien de réinitialisation.
              </p>
              <Link
                to="/login"
                className="inline-block text-sm text-primary-500 hover:underline mt-2"
              >
                Retour à la connexion
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <p className="text-text-muted text-sm">
                Entrez votre adresse email et nous vous enverrons un lien pour
                réinitialiser votre mot de passe.
              </p>

              <div>
                <label className="form-label" htmlFor="email">
                  Adresse email
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="form-input"
                  placeholder="votre@email.com"
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
                    Envoi en cours…
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <Send size={16} />
                    Envoyer le lien
                  </span>
                )}
              </button>

              <div className="text-center">
                <Link to="/login" className="text-xs text-text-muted hover:text-primary-500 hover:underline">
                  Retour à la connexion
                </Link>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
