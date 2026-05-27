/**
 * ClientFormPage — /clients/new  and  /clients/:id/edit
 *
 * Creates or updates a client. Redirects to the client detail page on success.
 */
import { useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
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
} from "lucide-react";
import api, { getApiError } from "@/lib/api";
import type { Client } from "@/types";
import { cn } from "@/lib/utils";

// ── Algerian wilayas (1–58) for datalist ─────────────────────────────────────
const WILAYAS = [
  "01 - Adrar", "02 - Chlef", "03 - Laghouat", "04 - Oum El Bouaghi",
  "05 - Batna", "06 - Béjaïa", "07 - Biskra", "08 - Béchar",
  "09 - Blida", "10 - Bouira", "11 - Tamanrasset", "12 - Tébessa",
  "13 - Tlemcen", "14 - Tiaret", "15 - Tizi Ouzou", "16 - Alger",
  "17 - Djelfa", "18 - Jijel", "19 - Sétif", "20 - Saïda",
  "21 - Skikda", "22 - Sidi Bel Abbès", "23 - Annaba", "24 - Guelma",
  "25 - Constantine", "26 - Médéa", "27 - Mostaganem", "28 - M'Sila",
  "29 - Mascara", "30 - Ouargla", "31 - Oran", "32 - El Bayadh",
  "33 - Illizi", "34 - Bordj Bou Arréridj", "35 - Boumerdès",
  "36 - El Tarf", "37 - Tindouf", "38 - Tissemsilt", "39 - El Oued",
  "40 - Khenchela", "41 - Souk Ahras", "42 - Tipaza", "43 - Mila",
  "44 - Aïn Defla", "45 - Naâma", "46 - Aïn Témouchent", "47 - Ghardaïa",
  "48 - Relizane", "49 - Timimoun", "50 - Bordj Badji Mokhtar",
  "51 - Ouled Djellal", "52 - Béni Abbès", "53 - In Salah",
  "54 - In Guezzam", "55 - Touggourt", "56 - Djanet",
  "57 - El M'Ghair", "58 - El Meniaa",
];

// ── Form state ────────────────────────────────────────────────────────────────

interface FormState {
  name: string;
  phone: string;
  email: string;
  address: string;
  wilaya: string;
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
  icon?: React.FC<{ size?: number; className?: string }>;
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
  const { id } = useParams<{ id: string }>();
  const isEditing = !!id;
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
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
      const savedId: number = res.data.id ?? parseInt(id!);
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      queryClient.invalidateQueries({ queryKey: ["client", String(savedId)] });
      setSaved(true);
      setTimeout(() => navigate(`/clients/${savedId}`), 700);
    },
    onError: (err) => setFormError(getApiError(err)),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { setFormError("Le nom du client est obligatoire."); return; }
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
        <span className="text-sm">Chargement du client...</span>
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

              <Field label="Nom / Raison sociale" required icon={User}>
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
                <Field label="NIF" icon={FileText}>
                  <input
                    type="text"
                    value={form.nif}
                    onChange={set("nif")}
                    className="form-input"
                    placeholder="00012345678901234"
                  />
                </Field>
                <Field label="Registre de Commerce" icon={Building2}>
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
                <Field label="Téléphone" icon={Phone}>
                  <input
                    type="tel"
                    value={form.phone}
                    onChange={set("phone")}
                    className="form-input"
                    placeholder="0550 000 000"
                  />
                </Field>
                <Field label="Email" icon={Mail}>
                  <input
                    type="email"
                    value={form.email}
                    onChange={set("email")}
                    className="form-input"
                    placeholder="client@example.com"
                  />
                </Field>
              </div>

              <Field label="Adresse" icon={MapPin}>
                <input
                  type="text"
                  value={form.address}
                  onChange={set("address")}
                  className="form-input"
                  placeholder="Rue, quartier, commune..."
                />
              </Field>

              <Field label="Wilaya" icon={MapPin}>
                <input
                  type="text"
                  list="wilaya-list"
                  value={form.wilaya}
                  onChange={set("wilaya")}
                  className="form-input"
                  placeholder="Ex: 16 - Alger"
                />
                <datalist id="wilaya-list">
                  {WILAYAS.map((w) => (
                    <option key={w} value={w} />
                  ))}
                </datalist>
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
