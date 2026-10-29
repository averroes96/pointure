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
      <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 mb-1.5">
        {Icon && <Icon size={12} className="text-slate-400 shrink-0" />}
        {label}
        {required && <span className="text-rose-500">*</span>}
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
      <div className="flex items-center justify-center h-48 gap-2 text-slate-400">
        <Loader2 size={18} className="animate-spin text-primary-600" />
        <span className="text-sm font-medium">{t("common.loading")}</span>
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-4xl">
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <Link
          to={isEditing ? `/clients/${id}` : "/clients"}
          className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
        >
          <ArrowLeft size={20} />
        </Link>
        <div>
          <h1 className="text-2xl font-bold font-sans tracking-tight text-slate-900">
            {isEditing ? t("client.edit_client") : t("client.new")}
          </h1>
          <p className="text-xs font-medium text-slate-500 mt-0.5">
            {isEditing
              ? t("client.identity_desc")
              : t("client.identity_desc_new")}
          </p>
        </div>
      </div>

      {/* ── Form ──────────────────────────────────────────────────────────── */}
      <form onSubmit={handleSubmit} className="space-y-5">

        {/* Error banner */}
        {formError && (
          <div className="flex items-center gap-2 px-4 py-3 bg-rose-50 border border-rose-200 rounded-xl text-xs font-medium text-rose-700 animate-in fade-in">
            <AlertTriangle size={15} className="shrink-0" />
            <span className="flex-1">{formError}</span>
            <button type="button" onClick={() => setFormError(null)} className="text-rose-500 hover:text-rose-800">
              <X size={14} />
            </button>
          </div>
        )}

        {saved && (
          <div className="flex items-center gap-2 px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs font-semibold text-emerald-800 animate-in fade-in">
            <CheckCircle size={15} className="text-emerald-600" />
            Client enregistré avec succès. Redirection...
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">

          {/* ── Left: Identity & Contact ─────────────────────────────────── */}
          <div className="lg:col-span-3 space-y-4">

            {/* Identity */}
            <div className="card p-5 rounded-2xl border border-slate-200/80 bg-white shadow-xs space-y-4">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700 border-b border-slate-100 pb-2.5">
                Identité
              </h2>

              <Field label={t("client.name_social")} required icon={User}>
                <input
                  type="text"
                  value={form.name}
                  onChange={set("name")}
                  className="form-input rounded-xl border-slate-200/90 shadow-2xs focus:ring-primary-500/20 text-xs font-medium"
                  placeholder={t("client.name_placeholder")}
                  autoFocus
                />
              </Field>

              <div className="grid grid-cols-2 gap-3.5">
                <Field label={t("client.nif")} icon={FileText}>
                  <input
                    type="text"
                    value={form.nif}
                    onChange={set("nif")}
                    className="form-input rounded-xl border-slate-200/90 shadow-2xs focus:ring-primary-500/20 text-xs font-mono"
                    placeholder="00012345678901234"
                  />
                </Field>
                <Field label={t("client.rc")} icon={Building2}>
                  <input
                    type="text"
                    value={form.rc}
                    onChange={set("rc")}
                    className="form-input rounded-xl border-slate-200/90 shadow-2xs focus:ring-primary-500/20 text-xs font-mono"
                    placeholder="16/00-0123456B12"
                  />
                </Field>
              </div>
            </div>

            {/* Contact */}
            <div className="card p-5 rounded-2xl border border-slate-200/80 bg-white shadow-xs space-y-4">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700 border-b border-slate-100 pb-2.5">
                {t("client.contact")}
              </h2>

              <div className="grid grid-cols-2 gap-3.5">
                <Field label={t("client.phone_label")} icon={Phone}>
                  <input
                    type="tel"
                    value={form.phone}
                    onChange={set("phone")}
                    className="form-input rounded-xl border-slate-200/90 shadow-2xs focus:ring-primary-500/20 text-xs font-mono"
                    placeholder="0550 000 000"
                  />
                </Field>
                <Field label={t("client.email")} icon={Mail}>
                  <input
                    type="email"
                    value={form.email}
                    onChange={set("email")}
                    className="form-input rounded-xl border-slate-200/90 shadow-2xs focus:ring-primary-500/20 text-xs font-mono"
                    placeholder="client@example.com"
                  />
                </Field>
              </div>

              <Field label={t("client.address")} icon={MapPin}>
                <input
                  type="text"
                  value={form.address}
                  onChange={set("address")}
                  className="form-input rounded-xl border-slate-200/90 shadow-2xs focus:ring-primary-500/20 text-xs"
                  placeholder={t("client.address_placeholder")}
                />
              </Field>

              <Field label={t("client.wilaya")} icon={MapPin}>
                <select
                  className="form-input rounded-xl border-slate-200/90 shadow-2xs focus:ring-primary-500/20 text-xs"
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
            <div className="card p-5 rounded-2xl border border-slate-200/80 bg-white shadow-xs space-y-3">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700 border-b border-slate-100 pb-2.5">
                {t("client.internal_notes")}
              </h2>
              <textarea
                value={form.notes}
                onChange={set("notes")}
                className="form-input rounded-xl border-slate-200/90 shadow-2xs focus:ring-primary-500/20 text-xs resize-none"
                rows={3}
                placeholder={t("client.notes_placeholder")}
              />
            </div>
          </div>

          {/* ── Right: Commercial settings ───────────────────────────────── */}
          <div className="lg:col-span-2 flex flex-col gap-4">

            {/* Credit */}
            <div className="card p-5 rounded-2xl border border-slate-200/80 bg-white shadow-xs space-y-4">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700 border-b border-slate-100 pb-2.5">
                {t("client.financials")}
              </h2>

              {/* Client type toggle */}
              <div>
                <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 mb-1.5">
                  <Building2 size={12} className="text-slate-400 shrink-0" />
                  {t("client.client_type")}
                </label>
                <div className="flex rounded-xl border border-slate-200/90 bg-slate-100/80 p-1 text-xs">
                  {(["retail", "wholesale"] as ClientType[]).map((tVal) => (
                    <button
                      key={tVal}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, client_type: tVal }))}
                      className={cn(
                        "flex-1 py-1.5 px-3 rounded-lg font-semibold transition-all text-xs",
                        form.client_type === tVal
                          ? "bg-white text-slate-900 shadow-2xs"
                          : "text-slate-500 hover:text-slate-800"
                      )}
                    >
                      {tVal === "retail" ? t("client.retail_full") : t("client.wholesale_full")}
                    </button>
                  ))}
                </div>
                <p className="text-2xs text-slate-500 mt-1.5 font-medium">
                  {form.client_type === "retail"
                    ? t("client.retail_loyalty_hint")
                    : t("client.wholesale_loyalty_hint")}
                </p>
              </div>

              <Field
                label={`${t("client.credit_limit")} (DZD)`}
                icon={CreditCard}
              >
                <input
                  type="number"
                  value={form.credit_limit}
                  onChange={set("credit_limit")}
                  className="form-input rounded-xl border-slate-200/90 shadow-2xs focus:ring-primary-500/20 text-xs font-mono"
                  placeholder="0"
                  min="0"
                  step="1000"
                />
                <p className="text-2xs text-slate-500 mt-1 font-medium">
                  Mettre 0 pour désactiver la limite de crédit.
                </p>
              </Field>
            </div>

            {/* Status */}
            <div className="card p-5 rounded-2xl border border-slate-200/80 bg-white shadow-xs">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold text-slate-900">{t("common.active")}</p>
                  <p className="text-2xs text-slate-500 mt-0.5 font-medium">
                    Les clients inactifs sont masqués des sélecteurs de vente.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, is_active: !f.is_active }))}
                  className={cn(
                    "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200",
                    form.is_active ? "bg-primary-600" : "bg-slate-300"
                  )}
                  role="switch"
                  aria-checked={form.is_active}
                >
                  <span
                    className={cn(
                      "pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm transform transition-transform duration-200",
                      form.is_active ? "translate-x-5" : "translate-x-0"
                    )}
                  />
                </button>
              </div>
            </div>

            {/* Summary preview (edit mode) */}
            {isEditing && existingClient && (
              <div className="card p-5 rounded-2xl border border-slate-200/80 bg-slate-50/70 space-y-2">
                <p className="text-2xs font-semibold text-slate-500 uppercase tracking-wider">
                  {t("client.current_balance")}
                </p>
                <p
                  className={cn(
                    "text-xl font-mono font-bold tabular-nums",
                    parseFloat(existingClient.cached_balance) > 0
                      ? "text-rose-600"
                      : "text-emerald-700"
                  )}
                >
                  {parseFloat(existingClient.cached_balance).toLocaleString("fr-DZ", {
                    minimumFractionDigits: 2,
                  })}{" "}
                  <span className="text-xs font-normal text-slate-400">DZD</span>
                </p>
                <p className="text-2xs text-slate-500 font-medium">
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
            className="btn-secondary rounded-xl"
          >
            {t("common.cancel")}
          </Link>
          <button
            type="submit"
            disabled={saveMutation.isPending || saved}
            className="btn-primary rounded-xl shadow-xs shadow-primary-500/20"
          >
            {saveMutation.isPending ? (
              <><Loader2 size={14} className="animate-spin" /> {t("common.saving")}</>
            ) : (
              <><Save size={14} /> {isEditing ? t("common.save") : t("client.create_client")}</>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
