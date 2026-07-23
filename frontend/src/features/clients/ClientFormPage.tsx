/**
 * ClientFormPage — /clients/new  and  /clients/:id/edit
 *
 * Creates or updates a client. Redirects to the client detail page on success.
 */
import { useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Save,
  Loader2,
  AlertTriangle,
  CheckCircle,
  X,
  User,
  Phone,
  Mail,
  MapPin,
  Building2,
  FileText,
  CreditCard,
  type LucideIcon,
} from "lucide-react";
import api, { getApiError } from "@/lib/api";
import type { Client, ClientType } from "@/types";
import { cn } from "@/lib/utils";
import { wilayaLabel, parseWilayaCode } from "@/lib/wilayas";
import { useWilayas } from "@/hooks/useLocationData";

// ── Form state ────────────────────────────────────────────────────────────────

interface FormState {
  name: string;
  phone: string;
  email: string;
  address: string;
  wilaya: string;
  client_type: ClientType;
  nif: string;
  rc: string;
  credit_limit: string;
  notes: string;
  is_active: boolean;
}

const EMPTY_FORM: FormState = {
  name: "",
  phone: "",
  email: "",
  address: "",
  wilaya: "",
  client_type: "retail",
  nif: "",
  rc: "",
  credit_limit: "0",
  notes: "",
  is_active: true,
};

// ── Field wrapper ─────────────────────────────────────────────────────────────

function Field({
  label,
  required,
  icon: Icon,
  children,
}: {
  label: string;
  required?: boolean;
  icon?: LucideIcon;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="flex items-center gap-1.5 text-xs font-medium text-text-muted mb-1">
        {Icon && <Icon size={11} className="flex-shrink-0" />}
        {label}
        {required && <span className="text-danger">*</span>}
      </label>
      {children}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function ClientFormPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const isEditing = !!id;
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);

  const { data: wilayas } = useWilayas();
  const [saved, setSaved] = useState(false);

  // ── Load existing client when editing ───────────────────────────────────────

  const { isLoading: loadingClient } = useQuery<Client>({
    queryKey: ["client", id],
    queryFn: () => api.get(`/clients/${id}/`).then((r) => r.data),
    enabled: isEditing,
    staleTime: 0,
  });

  // We use a separate query that just reads cached data to populate the form
  const { data: existingClient } = useQuery<Client>({
    queryKey: ["client", id],
    enabled: isEditing,
  });

  useEffect(() => {
    if (!existingClient) return;
    setForm({
      name: existingClient.name ?? "",
      phone: existingClient.phone ?? "",
      email: existingClient.email ?? "",
      address: existingClient.address ?? "",
      wilaya: existingClient.wilaya ?? "",
      client_type: existingClient.client_type ?? "retail",
      nif: existingClient.nif ?? "",
      rc: existingClient.rc ?? "",
      credit_limit: existingClient.credit_limit ?? "0",
      notes: existingClient.notes ?? "",
      is_active: existingClient.is_active,
    });
  }, [existingClient?.id]);

  // ── Save mutation ─────────────────────────────────────────────────────────

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = {
        ...form,
        credit_limit: form.credit_limit || "0",
      };
      if (isEditing) return api.patch(`/clients/${id}/`, payload);
      return api.post("/clients/", payload);
    },
    onSuccess: (res) => {
      const savedId = res.data.id ?? id!;
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      queryClient.invalidateQueries({ queryKey: ["client", String(savedId)] });
      setSaved(true);
      setTimeout(() => navigate(`/clients/${savedId}`), 700);
    },
    onError: (err) => setFormError(getApiError(err)),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setFormError(t("client.name_required")); return; }
    setFormError(null);
    saveMutation.mutate();
  }

  function set(field: keyof FormState) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  if (isEditing && loadingClient && !existingClient) {
    return (
      <div className="flex items-center justify-center h-48 gap-2 text-text-muted">
        <Loader2 size={18} className="animate-spin" />
        <span className="text-sm">{t("common.loading")}</span>
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-4xl">
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <Link
          to={isEditing ? `/clients/${id}` : "/clients"}
          className="text-text-muted hover:text-text-primary transition-colors"
        >
          <ArrowLeft size={20} />
        </Link>
        <div>
          <h1 className="text-xl font-bold text-text-primary">
            {isEditing ? "Modifier le client" : "Nouveau client"}
          </h1>
          <p className="text-sm text-text-muted">
            {isEditing
              ? "Modifiez les informations du client."
              : "Remplissez les informations pour créer un nouveau client."}
          </p>
        </div>
      </div>

      {/* ── Form ──────────────────────────────────────────────────────────── */}
      <form onSubmit={handleSubmit} className="space-y-4">

        {/* Error banner */}
        {formError && (
          <div className="flex items-center gap-2 px-4 py-3 bg-danger-light border border-danger/30 rounded-lg text-sm text-danger">
            <AlertTriangle size={14} className="flex-shrink-0" />
            <span className="flex-1">{formError}</span>
            <button type="button" onClick={() => setFormError(null)}>
              <X size={14} />
            </button>
          </div>
        )}

        {saved && (
          <div className="flex items-center gap-2 px-4 py-3 bg-success/10 border border-success/30 rounded-lg text-sm text-success">
            <CheckCircle size={14} />
            Client enregistré avec succès. Redirection...
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">

          {/* ── Left: Identity & Contact ─────────────────────────────────── */}
          <div className="lg:col-span-3 space-y-4">

            {/* Identity */}
            <div className="card p-5 space-y-4">
              <h2 className="text-sm font-semibold text-text-primary border-b border-border pb-2">
                Identité
              </h2>

              <Field label={t("client.name_social")} required icon={User}>
                <input
                  type="text"
                  value={form.name}
                  onChange={set("name")}
                  className="form-input"
                  placeholder="Ex: SARL El Baraka"
                  autoFocus
                />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label={t("client.nif")} icon={FileText}>
                  <input
                    type="text"
                    value={form.nif}
                    onChange={set("nif")}
                    className="form-input"
                    placeholder="00012345678901234"
                  />
                </Field>
                <Field label={t("client.rc")} icon={Building2}>
                  <input
                    type="text"
                    value={form.rc}
                    onChange={set("rc")}
                    className="form-input"
                    placeholder="16/00-0123456B12"
                  />
                </Field>
              </div>
            </div>

            {/* Contact */}
            <div className="card p-5 space-y-4">
              <h2 className="text-sm font-semibold text-text-primary border-b border-border pb-2">
                Contact
              </h2>

              <div className="grid grid-cols-2 gap-3">
                <Field label={t("client.phone_label")} icon={Phone}>
                  <input
                    type="tel"
                    value={form.phone}
                    onChange={set("phone")}
                    className="form-input"
                    placeholder="0550 000 000"
                  />
                </Field>
                <Field label={t("client.email")} icon={Mail}>
                  <input
                    type="email"
                    value={form.email}
                    onChange={set("email")}
                    className="form-input"
                    placeholder="client@example.com"
                  />
                </Field>
              </div>

              <Field label={t("client.address")} icon={MapPin}>
                <input
                  type="text"
                  value={form.address}
                  onChange={set("address")}
                  className="form-input"
                  placeholder="Rue, quartier, commune..."
                />
              </Field>

              <Field label={t("client.wilaya")} icon={MapPin}>
                <select
                  className="form-input"
                  value={form.wilaya}
                  onChange={(e) => setForm((f) => ({ ...f, wilaya: e.target.value }))}
                >
                  <option value="">Sélectionnez une wilaya...</option>
                  {wilayas?.map((w) => (
                    <option key={w.code} value={w.code}>
                      {w.code} - {w.name} ({w.ar_name})
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            {/* Notes */}
            <div className="card p-5 space-y-3">
              <h2 className="text-sm font-semibold text-text-primary border-b border-border pb-2">
                Notes internes
              </h2>
              <textarea
                value={form.notes}
                onChange={set("notes")}
                className="form-input resize-none"
                rows={3}
                placeholder="Remarques, conditions spéciales..."
              />
            </div>
          </div>

          {/* ── Right: Commercial settings ───────────────────────────────── */}
          <div className="lg:col-span-2 flex flex-col gap-4">

            {/* Credit */}
            <div className="card p-5 space-y-4">
              <h2 className="text-sm font-semibold text-text-primary border-b border-border pb-2">
                Conditions commerciales
              </h2>

              {/* Client type toggle */}
              <div>
                <label className="flex items-center gap-1.5 text-xs font-medium text-text-muted mb-1.5">
                  <Building2 size={11} className="flex-shrink-0" />
                  Type de client
                </label>
                <div className="flex rounded-lg border border-border overflow-hidden text-sm">
                  {(["retail", "wholesale"] as ClientType[]).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, client_type: t }))}
                      className={cn(
                        "flex-1 py-2 font-medium transition-colors",
                        form.client_type === t
                          ? "bg-primary-500 text-white"
                          : "bg-surface text-text-muted hover:bg-surface/80"
                      )}
                    >
                      {t === "retail" ? "Détail" : "Gros"}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-text-muted mt-1">
                  {form.client_type === "retail"
                    ? "Client particulier — éligible au programme fidélité."
                    : "Partenaire grossiste — exclu du programme fidélité."}
                </p>
              </div>

              <Field
                label="Limite de crédit (DZD)"
                icon={CreditCard}
              >
                <input
                  type="number"
                  value={form.credit_limit}
                  onChange={set("credit_limit")}
                  className="form-input"
                  placeholder="0"
                  min="0"
                  step="1000"
                />
                <p className="text-xs text-text-muted mt-0.5">
                  Mettre 0 pour désactiver la limite de crédit.
                </p>
              </Field>
            </div>

            {/* Status */}
            <div className="card p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-text-primary">Client actif</p>
                  <p className="text-xs text-text-muted mt-0.5">
                    Les clients inactifs n'apparaissent pas dans les recherches.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, is_active: !f.is_active }))}
                  className={cn(
                    "relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
                    form.is_active ? "bg-primary-500" : "bg-border"
                  )}
                  role="switch"
                  aria-checked={form.is_active}
                >
                  <span
                    className={cn(
                      "pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transform transition-transform",
                      form.is_active ? "translate-x-5" : "translate-x-0"
                    )}
                  />
                </button>
              </div>
            </div>

            {/* Summary preview (edit mode) */}
            {isEditing && existingClient && (
              <div className="card p-5 space-y-2 bg-surface/60">
                <p className="text-xs font-semibold text-text-muted uppercase tracking-wide">
                  Solde actuel
                </p>
                <p
                  className={cn(
                    "text-2xl font-mono font-bold",
                    parseFloat(existingClient.cached_balance) > 0
                      ? "text-warning"
                      : "text-success"
                  )}
                >
                  {parseFloat(existingClient.cached_balance).toLocaleString("fr-DZ", {
                    minimumFractionDigits: 2,
                  })}{" "}
                  <span className="text-sm font-normal text-text-muted">DZD</span>
                </p>
                <p className="text-xs text-text-muted">
                  Créé le{" "}
                  {new Date(existingClient.created_at).toLocaleDateString("fr-DZ", {
                    day: "2-digit",
                    month: "long",
                    year: "numeric",
                  })}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* ── Submit ────────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-end gap-3 pt-2">
          <Link
            to={isEditing ? `/clients/${id}` : "/clients"}
            className="btn-secondary"
          >
            Annuler
          </Link>
          <button
            type="submit"
            disabled={saveMutation.isPending || saved}
            className="btn-primary"
          >
            {saveMutation.isPending ? (
              <><Loader2 size={14} className="animate-spin" /> Enregistrement…</>
            ) : (
              <><Save size={14} /> {isEditing ? "Enregistrer les modifications" : "Créer le client"}</>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
