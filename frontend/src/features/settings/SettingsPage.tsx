import { useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useForm } from "react-hook-form";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { User, Building2, Shield, Users, MapPin, Upload, Banknote, type LucideIcon } from "lucide-react";
import api, { getApiError, type PaginatedResponse } from "@/lib/api";
import type { User as UserType, Branch, StoreSettings, Tenant } from "@/types";
import { cn } from "@/lib/utils";
import { useAuth } from "@/features/auth/AuthContext";
import { WILAYA_ENTRIES, wilayaLabel, parseWilayaCode } from "@/lib/wilayas";

// ─── Shared Toast ──────────────────────────────────────────────────────────

function Toast({
  message,
  type,
}: {
  message: string;
  type: "success" | "error";
}) {
  const { t } = useTranslation();
  if (!message) return null;
  return (
    <div
      className={cn(
        "rounded-md px-4 py-3 text-sm font-medium",
        type === "success"
          ? "bg-success-light text-success border border-success/20"
          : "bg-danger-light text-danger border border-danger/20"
      )}
    >
      {message}
    </div>
  );
}

// ─── Tab: Profil ──────────────────────────────────────────────────────────

interface ProfileFormData {
  first_name: string;
  last_name: string;
  phone: string;
  language_preference: "ar" | "fr" | "en";
}

function ProfileTab({ user }: { user: UserType }) {
  const { t } = useTranslation();
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);
  const { register, handleSubmit, formState: { errors, isDirty } } = useForm<ProfileFormData>({
    defaultValues: {
      first_name: user.first_name,
      last_name: user.last_name,
      phone: user.phone,
      language_preference: user.language_preference,
    },
  });

  const mutation = useMutation({
    mutationFn: (data: ProfileFormData) =>
      api.patch("/core/me/update_profile/", data).then((r) => r.data),
    onSuccess: () => setToast({ msg: t("settings.profile_updated"), type: "success" }),
    onError: (err) => setToast({ msg: getApiError(err), type: "error" }),
  });

  function onSubmit(data: ProfileFormData) {
    setToast(null);
    mutation.mutate(data);
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5 max-w-lg">
      {toast && <Toast message={toast.msg} type={toast.type} />}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="form-label">{t("user.first_name")}</label>
          <input
            type="text"
            {...register("first_name", { required: "Obligatoire" })}
            className="form-input"
          />
          {errors.first_name && (
            <p className="form-error">{errors.first_name.message}</p>
          )}
        </div>
        <div>
          <label className="form-label">{t("user.last_name")}</label>
          <input
            type="text"
            {...register("last_name", { required: "Obligatoire" })}
            className="form-input"
          />
          {errors.last_name && (
            <p className="form-error">{errors.last_name.message}</p>
          )}
        </div>
      </div>

      <div>
        <label className="form-label">{t("user.phone")}</label>
        <input type="tel" {...register("phone")} className="form-input" placeholder="0550 000 000" />
      </div>

      <div>
        <label className="form-label">{t("user.language")}</label>
        <select {...register("language_preference")} className="form-input">
          <option value="fr">{t("user.lang_fr")}</option>
          <option value="ar">{t("user.lang_ar")}</option>
          <option value="en">{t("user.lang_en")}</option>
        </select>
      </div>

      <div className="flex items-center justify-end pt-2">
        <button
          type="submit"
          disabled={mutation.isPending || !isDirty}
          className="btn-primary"
        >
          {mutation.isPending ? t("common.saving") : t("common.save")}
        </button>
      </div>
    </form>
  );
}

// ─── Tab: Boutique ───────────────────────────────────────────────────────

interface TenantFormData {
  name: string;
  phone: string;
  address: string;
  nif: string;
  rc: string;
  ai: string;
}

function BoutiqueTab({ tenant }: { tenant: Tenant }) {
  const { t } = useTranslation();
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(tenant.logo);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { register, handleSubmit, formState: { errors, isDirty } } = useForm<TenantFormData>({
    defaultValues: {
      name: tenant.name,
      phone: tenant.phone,
      address: tenant.address,
      nif: tenant.nif,
      rc: tenant.rc,
      ai: tenant.ai,
    },
  });

  const mutation = useMutation({
    mutationFn: async (data: TenantFormData) => {
      const file = fileInputRef.current?.files?.[0];
      if (file) {
        const fd = new FormData();
        Object.entries(data).forEach(([k, v]) => fd.append(k, v));
        fd.append("logo", file);
        return api.patch("/core/tenant/update_settings/", fd, {
          headers: { "Content-Type": "multipart/form-data" },
        }).then((r) => r.data);
      }
      return api.patch("/core/tenant/update_settings/", data).then((r) => r.data);
    },
    onSuccess: () => setToast({ msg: t("settings.store_updated"), type: "success" }),
    onError: (err) => setToast({ msg: getApiError(err), type: "error" }),
  });

  function handleLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => setLogoPreview(ev.target?.result as string);
      reader.readAsDataURL(file);
    }
  }

  function onSubmit(data: TenantFormData) {
    setToast(null);
    mutation.mutate(data);
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5 max-w-lg">
      {toast && <Toast message={toast.msg} type={toast.type} />}

      {/* Logo */}
      <div>
        <label className="form-label">{t("settings.logo")}</label>
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-lg border border-border bg-surface flex items-center justify-center overflow-hidden flex-shrink-0">
            {logoPreview ? (
              <img src={logoPreview} alt={t("settings.logo")} className="w-full h-full object-contain" />
            ) : (
              <Building2 size={24} className="text-text-muted" />
            )}
          </div>
          <div>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="btn-secondary btn-sm"
            >
              <Upload size={14} />{t("settings.change_logo")}</button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleLogoChange}
            />
            <p className="text-xs text-text-muted mt-1">PNG, JPG. Max 2 Mo.</p>
          </div>
        </div>
      </div>

      <div>
        <label className="form-label">{t("settings.store_name_req")}</label>
        <input
          type="text"
          {...register("name", { required: "Obligatoire" })}
          className="form-input"
        />
        {errors.name && <p className="form-error">{errors.name.message}</p>}
      </div>

      <div>
        <label className="form-label">{t("user.phone")}</label>
        <input type="tel" {...register("phone")} className="form-input" />
      </div>

      <div>
        <label className="form-label">{t("settings.address")}</label>
        <textarea {...register("address")} rows={2} className="form-input resize-none" />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="form-label">{t("settings.nif")}</label>
          <input type="text" {...register("nif")} className="form-input" />
        </div>
        <div>
          <label className="form-label">{t("settings.rc")}</label>
          <input type="text" {...register("rc")} className="form-input" />
        </div>
        <div>
          <label className="form-label">{t("settings.ai")}</label>
          <input type="text" {...register("ai")} className="form-input" />
        </div>
      </div>

      <div className="flex items-center justify-end pt-2">
        <button
          type="submit"
          disabled={mutation.isPending || !isDirty}
          className="btn-primary"
        >
          {mutation.isPending ? t("common.saving") : t("common.save")}
        </button>
      </div>
    </form>
  );
}

// ─── Tab: Sécurité ───────────────────────────────────────────────────────

interface PasswordFormData {
  old_password: string;
  new_password: string;
  confirm: string;
}

function SecurityTab() {
  const { t } = useTranslation();
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);
  const { register, handleSubmit, watch, reset, formState: { errors } } = useForm<PasswordFormData>();

  const mutation = useMutation({
    mutationFn: (data: PasswordFormData) =>
      api.post("/core/me/change-password/", {
        old_password: data.old_password,
        new_password: data.new_password,
      }).then((r) => r.data),
    onSuccess: () => {
      setToast({ msg: "Mot de passe modifié avec succès.", type: "success" });
      reset();
    },
    onError: (err) => setToast({ msg: getApiError(err), type: "error" }),
  });

  function onSubmit(data: PasswordFormData) {
    setToast(null);
    mutation.mutate(data);
  }

  const newPassword = watch("new_password");

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5 max-w-md">
      {toast && <Toast message={toast.msg} type={toast.type} />}

      <div>
        <label className="form-label">{t("settings.current_password")}</label>
        <input
          type="password"
          {...register("old_password", { required: "Obligatoire" })}
          className="form-input"
          autoComplete="current-password"
        />
        {errors.old_password && <p className="form-error">{errors.old_password.message}</p>}
      </div>

      <div>
        <label className="form-label">{t("settings.new_password")}</label>
        <input
          type="password"
          {...register("new_password", {
            required: "Obligatoire",
            minLength: { value: 8, message: "Minimum 8 caractères" },
          })}
          className="form-input"
          autoComplete="new-password"
        />
        {errors.new_password && <p className="form-error">{errors.new_password.message}</p>}
      </div>

      <div>
        <label className="form-label">Confirmer le nouveau mot de passe</label>
        <input
          type="password"
          {...register("confirm", {
            required: "Obligatoire",
            validate: (val) => val === newPassword || t("settings.password_mismatch"),
          })}
          className="form-input"
          autoComplete="new-password"
        />
        {errors.confirm && <p className="form-error">{errors.confirm.message}</p>}
      </div>

      <div className="flex items-center justify-end pt-2">
        <button type="submit" disabled={mutation.isPending} className="btn-primary">
          {mutation.isPending ? "Modification..." : t("settings.change_password")}
        </button>
      </div>
    </form>
  );
}

// ─── Tab: Utilisateurs ───────────────────────────────────────────────────

interface InviteFormData {
  email: string;
  role: "manager" | "cashier";
  first_name: string;
  last_name: string;
  password: string;
  confirm_password: string;
}

function UsersTab() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [showInvite, setShowInvite] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  const { data, isLoading } = useQuery<PaginatedResponse<UserType>>({
    queryKey: ["settings", "users"],
    queryFn: () => api.get("/core/users/").then((r) => r.data),
  });

  const { register, handleSubmit, reset, formState: { errors } } = useForm<InviteFormData>({
    defaultValues: { role: "cashier" },
  });

  const inviteMutation = useMutation({
    mutationFn: (data: InviteFormData) =>
      api.post("/core/users/", data).then((r) => r.data),
    onSuccess: () => {
      setToast({ msg: "Invitation envoyée avec succès.", type: "success" });
      queryClient.invalidateQueries({ queryKey: ["settings", "users"] });
      setShowInvite(false);
      reset();
    },
    onError: (err) => setToast({ msg: getApiError(err), type: "error" }),
  });

  const deactivateMutation = useMutation({
    mutationFn: (userId: number) =>
      api.patch(`/core/users/${userId}/`, { is_active: false }).then((r) => r.data),
    onSuccess: () => {
      setToast({ msg: "Utilisateur désactivé.", type: "success" });
      queryClient.invalidateQueries({ queryKey: ["settings", "users"] });
    },
    onError: (err) => setToast({ msg: getApiError(err), type: "error" }),
  });

  const users = data?.results ?? [];

  const ROLE_LABELS: Record<string, string> = {
    owner: "Propriétaire",
    manager: "Gérant",
    cashier: "Caissier",
  };

  function onInvite(data: InviteFormData) {
    setToast(null);
    inviteMutation.mutate(data);
  }

  return (
    <div className="space-y-5">
      {toast && <Toast message={toast.msg} type={toast.type} />}

      <div className="flex items-center justify-between">
        <p className="text-sm text-text-muted">{users.length} utilisateur(s)</p>
        <button
          onClick={() => { setShowInvite(!showInvite); setToast(null); }}
          className="btn-primary btn-sm"
        >
          Inviter un utilisateur
        </button>
      </div>

      {/* Invite form */}
      {showInvite && (
        <div className="card card-body bg-surface">
          <h3 className="font-semibold text-text-primary mb-4">Nouvel utilisateur</h3>
          <form onSubmit={handleSubmit(onInvite)} className="space-y-4 max-w-md">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="form-label">{t("user.first_name")}</label>
                <input
                  type="text"
                  {...register("first_name", { required: "Obligatoire" })}
                  className="form-input"
                />
                {errors.first_name && <p className="form-error">{errors.first_name.message}</p>}
              </div>
              <div>
                <label className="form-label">{t("user.last_name")}</label>
                <input
                  type="text"
                  {...register("last_name", { required: "Obligatoire" })}
                  className="form-input"
                />
                {errors.last_name && <p className="form-error">{errors.last_name.message}</p>}
              </div>
            </div>
            <div>
              <label className="form-label">Email *</label>
              <input
                type="email"
                {...register("email", { required: "Obligatoire" })}
                className="form-input"
              />
              {errors.email && <p className="form-error">{errors.email.message}</p>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="form-label">Mot de passe *</label>
                <input
                  type="password"
                  autoComplete="new-password"
                  {...register("password", {
                    required: "Obligatoire",
                    minLength: { value: 8, message: "8 caractères minimum" },
                  })}
                  className="form-input"
                />
                {errors.password && <p className="form-error">{errors.password.message}</p>}
              </div>
              <div>
                <label className="form-label">Confirmer *</label>
                <input
                  type="password"
                  autoComplete="new-password"
                  {...register("confirm_password", {
                    required: "Obligatoire",
                    validate: (val, formVals) =>
                      val === formVals.password || "Les mots de passe ne correspondent pas",
                  })}
                  className="form-input"
                />
                {errors.confirm_password && (
                  <p className="form-error">{errors.confirm_password.message}</p>
                )}
              </div>
            </div>
            <div>
              <label className="form-label">{t("settings.role")}</label>
              <select {...register("role")} className="form-input">
                <option value="cashier">Caissier</option>
                <option value="manager">Gérant</option>
              </select>
            </div>
            <div className="flex gap-2">
              <button type="submit" disabled={inviteMutation.isPending} className="btn-primary btn-sm">
                {inviteMutation.isPending ? "Envoi..." : "Envoyer l'invitation"}
              </button>
              <button
                type="button"
                onClick={() => { setShowInvite(false); reset(); }}
                className="btn-secondary btn-sm"
              >
                Annuler
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Users table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>{t("user.last_name")}</th>
                <th>Email</th>
                <th>{t("settings.role")}</th>
                <th>Statut</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={5} className="text-center py-8 text-text-muted">{t("common.loading")}</td>
                </tr>
              )}
              {!isLoading && users.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center py-8 text-text-muted">Aucun utilisateur.</td>
                </tr>
              )}
              {users.map((u) => (
                <tr key={u.id}>
                  <td>
                    <div className="font-medium text-text-primary">{u.full_name || `${u.first_name} ${u.last_name}`}</div>
                  </td>
                  <td className="text-text-muted text-xs">{u.email}</td>
                  <td>
                    <span className={cn(
                      "badge",
                      u.role === "owner" ? "badge-info" : u.role === "manager" ? "badge-warning" : "badge-neutral"
                    )}>
                      {ROLE_LABELS[u.role] ?? u.role}
                    </span>
                  </td>
                  <td>
                    <span className={cn("badge", u.is_active ? "badge-success" : "badge-neutral")}>
                      {u.is_active ? t("settings.active") : t("settings.inactive")}
                    </span>
                  </td>
                  <td>
                    {u.is_active && u.role !== "owner" && (
                      <button
                        onClick={() => {
                          if (confirm(`Désactiver ${u.full_name || u.email} ?`)) {
                            deactivateMutation.mutate(u.id);
                          }
                        }}
                        className="btn-ghost btn-sm text-danger"
                        disabled={deactivateMutation.isPending}
                      >
                        Désactiver
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── Tab: Agences ────────────────────────────────────────────────────────

interface BranchFormData {
  name: string;
  address: string;
  wilaya: string;
  phone: string;
}

function AgencesTab() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  const { data, isLoading } = useQuery<PaginatedResponse<Branch>>({
    queryKey: ["settings", "branches"],
    queryFn: () => api.get("/core/branches/").then((r) => r.data),
  });

  const { register, handleSubmit, reset, watch, setValue, formState: { errors } } = useForm<BranchFormData>();
  const branchWilaya = watch("wilaya", "");

  const createMutation = useMutation({
    mutationFn: (data: BranchFormData) =>
      api.post("/core/branches/", data).then((r) => r.data),
    onSuccess: () => {
      setToast({ msg: "Agence créée avec succès.", type: "success" });
      queryClient.invalidateQueries({ queryKey: ["settings", "branches"] });
      setShowForm(false);
      reset();
    },
    onError: (err) => setToast({ msg: getApiError(err), type: "error" }),
  });

  const branches = data?.results ?? [];

  function onSubmit(data: BranchFormData) {
    setToast(null);
    createMutation.mutate(data);
  }

  return (
    <div className="space-y-5">
      {toast && <Toast message={toast.msg} type={toast.type} />}

      <div className="flex items-center justify-between">
        <p className="text-sm text-text-muted">{branches.length} agence(s)</p>
        <button
          onClick={() => { setShowForm(!showForm); setToast(null); }}
          className="btn-primary btn-sm"
        >
          Ajouter une agence
        </button>
      </div>

      {/* Add branch form */}
      {showForm && (
        <div className="card card-body bg-surface">
          <h3 className="font-semibold text-text-primary mb-4">Nouvelle agence</h3>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 max-w-md">
            <div>
              <label className="form-label">Nom *</label>
              <input
                type="text"
                {...register("name", { required: "Obligatoire" })}
                className="form-input"
                placeholder="Agence centrale, Annexe nord..."
              />
              {errors.name && <p className="form-error">{errors.name.message}</p>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="form-label">Wilaya</label>
                <input
                  type="text"
                  list="branch-wilaya-list"
                  className="form-input"
                  placeholder="Ex: 16 - Alger"
                  value={wilayaLabel(branchWilaya)}
                  onChange={(e) => setValue("wilaya", parseWilayaCode(e.target.value), { shouldDirty: true })}
                />
                <datalist id="branch-wilaya-list">
                  {WILAYA_ENTRIES.map(({ code, name }) => (
                    <option key={code} value={`${code} - ${name}`} />
                  ))}
                </datalist>
              </div>
              <div>
                <label className="form-label">{t("user.phone")}</label>
                <input type="tel" {...register("phone")} className="form-input" />
              </div>
            </div>
            <div>
              <label className="form-label">{t("settings.address")}</label>
              <input type="text" {...register("address")} className="form-input" />
            </div>
            <div className="flex gap-2">
              <button type="submit" disabled={createMutation.isPending} className="btn-primary btn-sm">
                {createMutation.isPending ? "Création..." : "Créer l'agence"}
              </button>
              <button
                type="button"
                onClick={() => { setShowForm(false); reset(); }}
                className="btn-secondary btn-sm"
              >
                Annuler
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Branches list */}
      <div className="space-y-3">
        {isLoading && (
          <div className="text-center py-8 text-text-muted">{t("common.loading")}</div>
        )}
        {!isLoading && branches.length === 0 && (
          <div className="text-center py-8 text-text-muted">Aucune agence enregistrée.</div>
        )}
        {branches.map((branch) => (
          <div key={branch.id} className="card card-body flex items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-primary-50 flex items-center justify-center flex-shrink-0">
                <MapPin size={16} className="text-primary-600" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-text-primary">{branch.name}</span>
                  {branch.is_headquarters && (
                    <span className="badge badge-info text-2xs">Siège</span>
                  )}
                  <span className={cn("badge", branch.is_active ? "badge-success" : "badge-neutral")}>
                    {branch.is_active ? "Active" : "Inactive"}
                  </span>
                </div>
                <div className="text-xs text-text-muted mt-0.5">
                  {[branch.address, branch.wilaya].filter(Boolean).join(", ") || "—"}
                  {branch.phone && ` · ${branch.phone}`}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Tab: Versements ─────────────────────────────────────────────────────

interface VersementsFormData {
  min_versement_pct: number;
  versement_due_days: number;
  versement_requires_client: boolean;
}

function VersementsTab() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  const { data: settings, isLoading } = useQuery<StoreSettings>({
    queryKey: ["store-settings"],
    queryFn: () => api.get("/core/store-settings/current/").then((r) => r.data),
  });

  const { register, handleSubmit, formState: { isDirty } } = useForm<VersementsFormData>({
    values: settings
      ? {
          min_versement_pct: settings.min_versement_pct,
          versement_due_days: settings.versement_due_days,
          versement_requires_client: settings.versement_requires_client,
        }
      : { min_versement_pct: 30, versement_due_days: 90, versement_requires_client: true },
  });

  const mutation = useMutation({
    mutationFn: (data: VersementsFormData) =>
      api.patch("/core/store-settings/update_settings/", data).then((r) => r.data),
    onSuccess: () => {
      setToast({ msg: "Parametres de versement mis a jour.", type: "success" });
      queryClient.invalidateQueries({ queryKey: ["store-settings"] });
    },
    onError: (err) => setToast({ msg: getApiError(err), type: "error" }),
  });

  function onSubmit(data: VersementsFormData) {
    setToast(null);
    mutation.mutate({
      ...data,
      min_versement_pct: Number(data.min_versement_pct),
      versement_due_days: Number(data.versement_due_days),
    });
  }

  if (isLoading) return <div className="text-text-muted py-4">{t("common.loading")}</div>;

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5 max-w-lg">
      {toast && <Toast message={toast.msg} type={toast.type} />}

      <div>
        <label className="form-label">Acompte minimum (%)</label>
        <input
          type="number"
          min={1}
          max={100}
          {...register("min_versement_pct", { required: "Obligatoire", min: 1, max: 100 })}
          className="form-input"
        />
        <p className="text-xs text-text-muted mt-1">
          Pourcentage du total de la vente requis comme premier paiement.
        </p>
      </div>

      <div>
        <label className="form-label">Delai de paiement (jours)</label>
        <input
          type="number"
          min={1}
          {...register("versement_due_days", { required: "Obligatoire", min: 1 })}
          className="form-input"
        />
        <p className="text-xs text-text-muted mt-1">
          Nombre de jours avant qu'un versement soit considere en retard.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <input
          type="checkbox"
          id="versement_requires_client"
          {...register("versement_requires_client")}
          className="w-4 h-4 accent-primary-600"
        />
        <label htmlFor="versement_requires_client" className="text-sm text-text-primary cursor-pointer">
          Exiger un client pour les versements
        </label>
      </div>

      <div className="flex items-center justify-end pt-2">
        <button
          type="submit"
          disabled={mutation.isPending || !isDirty}
          className="btn-primary"
        >
          {mutation.isPending ? t("common.saving") : t("common.save")}
        </button>
      </div>
    </form>
  );
}

// ─── Main SettingsPage ───────────────────────────────────────────────────

type TabKey = "profil" | "boutique" | "securite" | "utilisateurs" | "agences" | "versements";

interface Tab {
  key: TabKey;
  label: string;
  icon: LucideIcon;
  roles?: string[];
}

const TABS: Tab[] = [
  { key: "profil", label: t("settings.profile"), icon: User },
  { key: "boutique", label: t("settings.store"), icon: Building2, roles: ["owner", "manager"] },
  { key: "securite", label: "Securite", icon: Shield },
  { key: "utilisateurs", label: t("settings.users"), icon: Users, roles: ["owner", "manager"] },
  { key: "agences", label: "Agences", icon: MapPin, roles: ["owner", "manager"] },
  { key: "versements", label: "Versements", icon: Banknote, roles: ["owner"] },
];

export default function SettingsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<TabKey>("profil");

  // Fetch tenant data for boutique tab
  const { data: tenantData } = useQuery<Tenant>({
    queryKey: ["tenant", user?.tenant?.id],
    queryFn: () => api.get("/core/tenant/settings/").then((r) => r.data),
    enabled: !!user?.tenant?.id && (activeTab === "boutique"),
  });

  const visibleTabs = TABS.filter(
    (t) => !t.roles || (user && t.roles.includes(user.role))
  );

  if (!user) return null;

  const tenant = tenantData ?? user.tenant;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-text-primary">{t("nav.settings")}</h1>
        <p className="text-sm text-text-muted">Gérez votre profil et la configuration du système</p>
      </div>

      <div className="flex flex-col lg:flex-row gap-5">
        {/* Sidebar nav */}
        <div className="lg:w-48 flex-shrink-0">
          <div className="card overflow-hidden">
            <nav className="py-1">
              {visibleTabs.map((tab) => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.key}
                    onClick={() => setActiveTab(tab.key)}
                    className={cn(
                      "w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors text-left",
                      activeTab === tab.key
                        ? "bg-primary-50 text-primary-600 font-medium"
                        : "text-text-muted hover:bg-surface hover:text-text-primary"
                    )}
                  >
                    <Icon size={16} />
                    {tab.label}
                  </button>
                );
              })}
            </nav>
          </div>
        </div>

        {/* Tab content */}
        <div className="flex-1 min-w-0">
          <div className="card card-body">
            <h2 className="font-semibold text-text-primary mb-5">
              {visibleTabs.find((t) => t.key === activeTab)?.label}
            </h2>

            {activeTab === "profil" && <ProfileTab user={user} />}

            {activeTab === "boutique" && (
              tenant ? (
                <BoutiqueTab tenant={tenant as Tenant} />
              ) : (
                <div className="text-text-muted py-4">Chargement des informations boutique...</div>
              )
            )}

            {activeTab === "securite" && <SecurityTab />}

            {activeTab === "utilisateurs" && <UsersTab />}

            {activeTab === "agences" && <AgencesTab />}

            {activeTab === "versements" && <VersementsTab />}
          </div>
        </div>
      </div>
    </div>
  );
}
