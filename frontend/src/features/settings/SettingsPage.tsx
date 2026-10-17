import { useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useForm } from "react-hook-form";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  User,
  Building2,
  Shield,
  Users,
  MapPin,
  Upload,
  Banknote,
  Truck,
  Database,
  HardDrive,
  Monitor,
  Printer,
  CheckCircle2,
  AlertCircle,
  Plus,
  Lock,
  type LucideIcon,
} from "lucide-react";
import api, { getApiError, type PaginatedResponse } from "@/lib/api";
import DeliverySettingsTab from "@/features/deliveries/DeliverySettingsPage";
import { LegacyImportSection } from "./LegacyImportSection";
import DesktopTab from "./DesktopTab";
import PrintersTab from "./PrintersTab";
import type { User as UserType, Branch, StoreSettings, Tenant } from "@/types";
import { cn } from "@/lib/utils";
import { useAuth } from "@/features/auth/AuthContext";
import { useWilayas } from "@/hooks/useLocationData";
import i18n from "@/lib/i18n";

const t = i18n.t.bind(i18n);

// ─── Shared Toast ──────────────────────────────────────────────────────────

function Toast({
  message,
  type,
}: {
  message: string;
  type: "success" | "error";
}) {
  if (!message) return null;
  return (
    <div
      className={cn(
        "rounded-xl px-4 py-3 text-sm font-medium border flex items-center gap-3 shadow-xs transition-all",
        type === "success"
          ? "bg-emerald-50 text-emerald-800 border-emerald-200/80"
          : "bg-rose-50 text-rose-800 border-rose-200/80"
      )}
    >
      {type === "success" ? (
        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
      ) : (
        <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
      )}
      <span>{message}</span>
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
  const {
    register,
    handleSubmit,
    formState: { errors, isDirty },
  } = useForm<ProfileFormData>({
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
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6 max-w-xl">
      {toast && <Toast message={toast.msg} type={toast.type} />}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
            {t("user.first_name")} <span className="text-rose-500">*</span>
          </label>
          <input
            type="text"
            {...register("first_name", { required: "Obligatoire" })}
            className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-primary-500 focus:outline-none focus:ring-4 focus:ring-primary-500/10 transition-all"
          />
          {errors.first_name && (
            <p className="text-xs text-rose-600 mt-1">{errors.first_name.message}</p>
          )}
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
            {t("user.last_name")} <span className="text-rose-500">*</span>
          </label>
          <input
            type="text"
            {...register("last_name", { required: "Obligatoire" })}
            className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-primary-500 focus:outline-none focus:ring-4 focus:ring-primary-500/10 transition-all"
          />
          {errors.last_name && (
            <p className="text-xs text-rose-600 mt-1">{errors.last_name.message}</p>
          )}
        </div>
      </div>

      <div>
        <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
          {t("user.phone")}
        </label>
        <input
          type="tel"
          {...register("phone")}
          className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-primary-500 focus:outline-none focus:ring-4 focus:ring-primary-500/10 transition-all font-mono"
          placeholder="0550 000 000"
        />
      </div>

      <div>
        <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
          {t("user.language")}
        </label>
        <select
          {...register("language_preference")}
          className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-4 focus:ring-primary-500/10 transition-all"
        >
          <option value="fr">{t("user.lang_fr")}</option>
          <option value="ar">{t("user.lang_ar")}</option>
          <option value="en">{t("user.lang_en")}</option>
        </select>
      </div>

      <div className="flex items-center justify-end pt-4 border-t border-slate-100">
        <button
          type="submit"
          disabled={mutation.isPending || !isDirty}
          className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-primary-600 hover:bg-primary-700 text-white text-xs font-semibold shadow-xs shadow-primary-500/20 disabled:opacity-50 transition-all cursor-pointer"
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

  const {
    register,
    handleSubmit,
    formState: { errors, isDirty },
  } = useForm<TenantFormData>({
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
        return api
          .patch("/core/tenant/update_settings/", fd, {
            headers: { "Content-Type": "multipart/form-data" },
          })
          .then((r) => r.data);
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
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6 max-w-xl">
      {toast && <Toast message={toast.msg} type={toast.type} />}

      {/* Logo */}
      <div>
        <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2">
          {t("settings.logo")}
        </label>
        <div className="flex items-center gap-4">
          <div className="w-20 h-20 rounded-2xl border-2 border-slate-200/80 bg-slate-50/70 flex items-center justify-center overflow-hidden flex-shrink-0 shadow-2xs">
            {logoPreview ? (
              <img src={logoPreview} alt={t("settings.logo")} className="w-full h-full object-contain p-1" />
            ) : (
              <Building2 size={28} className="text-slate-400" />
            )}
          </div>
          <div>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold shadow-2xs transition-all cursor-pointer"
            >
              <Upload size={14} className="text-slate-500" />
              {t("settings.change_logo")}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleLogoChange}
            />
            <p className="text-xs text-slate-500 mt-1.5">Format PNG ou JPG. Max 2 Mo.</p>
          </div>
        </div>
      </div>

      <div>
        <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
          {t("settings.store_name_req")} <span className="text-rose-500">*</span>
        </label>
        <input
          type="text"
          {...register("name", { required: "Obligatoire" })}
          className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-primary-500 focus:outline-none focus:ring-4 focus:ring-primary-500/10 transition-all font-medium"
        />
        {errors.name && <p className="text-xs text-rose-600 mt-1">{errors.name.message}</p>}
      </div>

      <div>
        <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
          {t("user.phone")}
        </label>
        <input
          type="tel"
          {...register("phone")}
          className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-primary-500 focus:outline-none focus:ring-4 focus:ring-primary-500/10 transition-all font-mono"
        />
      </div>

      <div>
        <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
          {t("settings.address")}
        </label>
        <textarea
          {...register("address")}
          rows={2}
          className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-primary-500 focus:outline-none focus:ring-4 focus:ring-primary-500/10 transition-all resize-none"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
            {t("settings.nif")}
          </label>
          <input
            type="text"
            {...register("nif")}
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-primary-500 focus:outline-none focus:ring-4 focus:ring-primary-500/10 transition-all font-mono"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
            {t("settings.rc")}
          </label>
          <input
            type="text"
            {...register("rc")}
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-primary-500 focus:outline-none focus:ring-4 focus:ring-primary-500/10 transition-all font-mono"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
            {t("settings.ai")}
          </label>
          <input
            type="text"
            {...register("ai")}
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-primary-500 focus:outline-none focus:ring-4 focus:ring-primary-500/10 transition-all font-mono"
          />
        </div>
      </div>

      <div className="flex items-center justify-end pt-4 border-t border-slate-100">
        <button
          type="submit"
          disabled={mutation.isPending || !isDirty}
          className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-primary-600 hover:bg-primary-700 text-white text-xs font-semibold shadow-xs shadow-primary-500/20 disabled:opacity-50 transition-all cursor-pointer"
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
  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { errors },
  } = useForm<PasswordFormData>();

  const mutation = useMutation({
    mutationFn: (data: PasswordFormData) =>
      api
        .post("/core/me/change-password/", {
          old_password: data.old_password,
          new_password: data.new_password,
        })
        .then((r) => r.data),
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
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6 max-w-md">
      {toast && <Toast message={toast.msg} type={toast.type} />}

      <div>
        <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
          {t("settings.current_password")} <span className="text-rose-500">*</span>
        </label>
        <div className="relative">
          <input
            type="password"
            {...register("old_password", { required: "Obligatoire" })}
            className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-primary-500 focus:outline-none focus:ring-4 focus:ring-primary-500/10 transition-all font-mono"
            autoComplete="current-password"
          />
        </div>
        {errors.old_password && (
          <p className="text-xs text-rose-600 mt-1">{errors.old_password.message}</p>
        )}
      </div>

      <div>
        <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
          {t("settings.new_password")} <span className="text-rose-500">*</span>
        </label>
        <div className="relative">
          <input
            type="password"
            {...register("new_password", {
              required: "Obligatoire",
              minLength: { value: 8, message: "Minimum 8 caractères" },
            })}
            className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-primary-500 focus:outline-none focus:ring-4 focus:ring-primary-500/10 transition-all font-mono"
            autoComplete="new-password"
          />
        </div>
        {errors.new_password && (
          <p className="text-xs text-rose-600 mt-1">{errors.new_password.message}</p>
        )}
      </div>

      <div>
        <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
          Confirmer le nouveau mot de passe <span className="text-rose-500">*</span>
        </label>
        <div className="relative">
          <input
            type="password"
            {...register("confirm", {
              required: "Obligatoire",
              validate: (val) => val === newPassword || t("settings.password_mismatch"),
            })}
            className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-primary-500 focus:outline-none focus:ring-4 focus:ring-primary-500/10 transition-all font-mono"
            autoComplete="new-password"
          />
        </div>
        {errors.confirm && (
          <p className="text-xs text-rose-600 mt-1">{errors.confirm.message}</p>
        )}
      </div>

      <div className="flex items-center justify-end pt-4 border-t border-slate-100">
        <button
          type="submit"
          disabled={mutation.isPending}
          className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-primary-600 hover:bg-primary-700 text-white text-xs font-semibold shadow-xs shadow-primary-500/20 disabled:opacity-50 transition-all cursor-pointer"
        >
          <Lock size={14} />
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

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<InviteFormData>({
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
    <div className="space-y-6">
      {toast && <Toast message={toast.msg} type={toast.type} />}

      <div className="flex items-center justify-between gap-4">
        <div>
          <span className="text-sm font-semibold text-slate-700">Comptes d'accès</span>
          <span className="ml-2 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-600 border border-slate-200/80">
            {users.length} utilisateur(s)
          </span>
        </div>
        <button
          onClick={() => {
            setShowInvite(!showInvite);
            setToast(null);
          }}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-primary-600 hover:bg-primary-700 text-white text-xs font-semibold shadow-xs shadow-primary-500/20 transition-all cursor-pointer"
        >
          <Plus size={14} />
          <span>Inviter un utilisateur</span>
        </button>
      </div>

      {/* Invite form */}
      {showInvite && (
        <div className="rounded-2xl border border-slate-200/80 bg-slate-50/50 p-6 shadow-xs animate-in fade-in duration-150">
          <h3 className="font-bold text-slate-900 mb-4 text-sm flex items-center gap-2">
            <Users size={16} className="text-primary-600" />
            Nouvel utilisateur
          </h3>
          <form onSubmit={handleSubmit(onInvite)} className="space-y-4 max-w-lg">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                  {t("user.first_name")} <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  {...register("first_name", { required: "Obligatoire" })}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-4 focus:ring-primary-500/10 transition-all"
                />
                {errors.first_name && (
                  <p className="text-xs text-rose-600 mt-1">{errors.first_name.message}</p>
                )}
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                  {t("user.last_name")} <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  {...register("last_name", { required: "Obligatoire" })}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-4 focus:ring-primary-500/10 transition-all"
                />
                {errors.last_name && (
                  <p className="text-xs text-rose-600 mt-1">{errors.last_name.message}</p>
                )}
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                Email <span className="text-rose-500">*</span>
              </label>
              <input
                type="email"
                {...register("email", { required: "Obligatoire" })}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-4 focus:ring-primary-500/10 transition-all font-mono"
              />
              {errors.email && (
                <p className="text-xs text-rose-600 mt-1">{errors.email.message}</p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                  Mot de passe <span className="text-rose-500">*</span>
                </label>
                <input
                  type="password"
                  autoComplete="new-password"
                  {...register("password", {
                    required: "Obligatoire",
                    minLength: { value: 8, message: "8 caractères minimum" },
                  })}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-4 focus:ring-primary-500/10 transition-all font-mono"
                />
                {errors.password && (
                  <p className="text-xs text-rose-600 mt-1">{errors.password.message}</p>
                )}
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                  Confirmer <span className="text-rose-500">*</span>
                </label>
                <input
                  type="password"
                  autoComplete="new-password"
                  {...register("confirm_password", {
                    required: "Obligatoire",
                    validate: (val, formVals) =>
                      val === formVals.password || "Les mots de passe ne correspondent pas",
                  })}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-4 focus:ring-primary-500/10 transition-all font-mono"
                />
                {errors.confirm_password && (
                  <p className="text-xs text-rose-600 mt-1">{errors.confirm_password.message}</p>
                )}
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                {t("settings.role")}
              </label>
              <select
                {...register("role")}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-4 focus:ring-primary-500/10 transition-all font-medium"
              >
                <option value="cashier">Caissier</option>
                <option value="manager">Gérant</option>
              </select>
            </div>
            <div className="flex gap-2 pt-2">
              <button
                type="submit"
                disabled={inviteMutation.isPending}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary-600 hover:bg-primary-700 text-white text-xs font-semibold shadow-xs shadow-primary-500/20 disabled:opacity-50 transition-all cursor-pointer"
              >
                {inviteMutation.isPending ? "Envoi..." : "Envoyer l'invitation"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowInvite(false);
                  reset();
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold shadow-2xs transition-all cursor-pointer"
              >
                Annuler
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Users table */}
      <div className="rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50/70 border-b border-slate-200/80">
              <tr>
                <th className="py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  {t("user.last_name")}
                </th>
                <th className="py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Email
                </th>
                <th className="py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  {t("settings.role")}
                </th>
                <th className="py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Statut
                </th>
                <th className="py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-right">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading && (
                <tr>
                  <td colSpan={5} className="text-center py-8 text-slate-400">
                    {t("common.loading")}
                  </td>
                </tr>
              )}
              {!isLoading && users.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center py-8 text-slate-400">
                    Aucun utilisateur.
                  </td>
                </tr>
              )}
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-slate-50/60 transition-colors">
                  <td className="py-3.5 px-4">
                    <div className="font-semibold text-slate-900">
                      {u.full_name || `${u.first_name} ${u.last_name}`}
                    </div>
                  </td>
                  <td className="py-3.5 px-4 text-slate-500 text-xs font-mono">{u.email}</td>
                  <td className="py-3.5 px-4">
                    <span
                      className={cn(
                        "inline-flex items-center px-2.5 py-0.5 rounded-full text-2xs font-semibold border",
                        u.role === "owner"
                          ? "bg-purple-50 text-purple-700 border-purple-200"
                          : u.role === "manager"
                          ? "bg-blue-50 text-blue-700 border-blue-200"
                          : "bg-slate-100 text-slate-700 border-slate-200"
                      )}
                    >
                      {ROLE_LABELS[u.role] ?? u.role}
                    </span>
                  </td>
                  <td className="py-3.5 px-4">
                    <span
                      className={cn(
                        "inline-flex items-center px-2.5 py-0.5 rounded-full text-2xs font-semibold border",
                        u.is_active
                          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                          : "bg-slate-100 text-slate-500 border-slate-200"
                      )}
                    >
                      <span
                        className={cn(
                          "w-1.5 h-1.5 rounded-full mr-1.5",
                          u.is_active ? "bg-emerald-500" : "bg-slate-400"
                        )}
                      />
                      {u.is_active ? t("settings.active") : t("settings.inactive")}
                    </span>
                  </td>
                  <td className="py-3.5 px-4 text-right">
                    {u.is_active && u.role !== "owner" && (
                      <button
                        onClick={() => {
                          if (confirm(`Désactiver ${u.full_name || u.email} ?`)) {
                            deactivateMutation.mutate(u.id);
                          }
                        }}
                        className="inline-flex items-center px-2.5 py-1 rounded-lg text-rose-600 hover:text-rose-700 hover:bg-rose-50 text-xs font-semibold transition-all cursor-pointer"
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

  const { data: wilayas } = useWilayas();

  const { data, isLoading } = useQuery<PaginatedResponse<Branch>>({
    queryKey: ["settings", "branches"],
    queryFn: () => api.get("/core/branches/").then((r) => r.data),
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<BranchFormData>();

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
    <div className="space-y-6">
      {toast && <Toast message={toast.msg} type={toast.type} />}

      <div className="flex items-center justify-between gap-4">
        <div>
          <span className="text-sm font-semibold text-slate-700">Réseau d'agences</span>
          <span className="ml-2 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-600 border border-slate-200/80">
            {branches.length} agence(s)
          </span>
        </div>
        <button
          onClick={() => {
            setShowForm(!showForm);
            setToast(null);
          }}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-primary-600 hover:bg-primary-700 text-white text-xs font-semibold shadow-xs shadow-primary-500/20 transition-all cursor-pointer"
        >
          <Plus size={14} />
          <span>Ajouter une agence</span>
        </button>
      </div>

      {/* Add branch form */}
      {showForm && (
        <div className="rounded-2xl border border-slate-200/80 bg-slate-50/50 p-6 shadow-xs animate-in fade-in duration-150">
          <h3 className="font-bold text-slate-900 mb-4 text-sm flex items-center gap-2">
            <MapPin size={16} className="text-primary-600" />
            Nouvelle agence
          </h3>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 max-w-lg">
            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                Nom <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                {...register("name", { required: "Obligatoire" })}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-4 focus:ring-primary-500/10 transition-all"
                placeholder="Agence centrale, Annexe nord..."
              />
              {errors.name && <p className="text-xs text-rose-600 mt-1">{errors.name.message}</p>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                  Wilaya
                </label>
                <select
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-4 focus:ring-primary-500/10 transition-all"
                  {...register("wilaya")}
                >
                  <option value="">Sélectionner...</option>
                  {wilayas?.map((w) => (
                    <option key={w.code} value={w.code}>
                      {w.code} - {w.name} ({w.ar_name})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                  {t("user.phone")}
                </label>
                <input
                  type="tel"
                  {...register("phone")}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-4 focus:ring-primary-500/10 transition-all font-mono"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                {t("settings.address")}
              </label>
              <input
                type="text"
                {...register("address")}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-4 focus:ring-primary-500/10 transition-all"
              />
            </div>
            <div className="flex gap-2 pt-2">
              <button
                type="submit"
                disabled={createMutation.isPending}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary-600 hover:bg-primary-700 text-white text-xs font-semibold shadow-xs shadow-primary-500/20 disabled:opacity-50 transition-all cursor-pointer"
              >
                {createMutation.isPending ? "Création..." : "Créer l'agence"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowForm(false);
                  reset();
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold shadow-2xs transition-all cursor-pointer"
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
          <div className="text-center py-8 text-slate-400">{t("common.loading")}</div>
        )}
        {!isLoading && branches.length === 0 && (
          <div className="text-center py-8 text-slate-400">Aucune agence enregistrée.</div>
        )}
        {branches.map((branch) => (
          <div
            key={branch.id}
            className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-xs hover:border-slate-300 transition-all flex items-center justify-between gap-4"
          >
            <div className="flex items-start gap-3.5">
              <div className="w-10 h-10 rounded-xl bg-primary-50 border border-primary-100/60 flex items-center justify-center flex-shrink-0 text-primary-600">
                <MapPin size={18} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-slate-900 text-sm">{branch.name}</span>
                  {branch.is_headquarters && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-2xs font-bold bg-primary-50 text-primary-700 border border-primary-200">
                      Siège
                    </span>
                  )}
                  <span
                    className={cn(
                      "inline-flex items-center px-2 py-0.5 rounded-full text-2xs font-semibold border",
                      branch.is_active
                        ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                        : "bg-slate-100 text-slate-500 border-slate-200"
                    )}
                  >
                    {branch.is_active ? "Active" : "Inactive"}
                  </span>
                </div>
                <div className="text-xs text-slate-500 mt-1">
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
  allow_negative_stock: boolean;
}

function VersementsTab() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  const { data: settings, isLoading } = useQuery<StoreSettings>({
    queryKey: ["store-settings"],
    queryFn: () => api.get("/core/store-settings/current/").then((r) => r.data),
  });

  const {
    register,
    handleSubmit,
    formState: { isDirty },
  } = useForm<VersementsFormData>({
    values: settings
      ? {
          min_versement_pct: settings.min_versement_pct,
          versement_due_days: settings.versement_due_days,
          versement_requires_client: settings.versement_requires_client,
          allow_negative_stock: settings.allow_negative_stock ?? false,
        }
      : {
          min_versement_pct: 30,
          versement_due_days: 90,
          versement_requires_client: true,
          allow_negative_stock: false,
        },
  });

  const mutation = useMutation({
    mutationFn: (data: VersementsFormData) =>
      api.patch("/core/store-settings/update_settings/", data).then((r) => r.data),
    onSuccess: () => {
      setToast({ msg: "Paramètres enregistrés avec succès.", type: "success" });
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
      allow_negative_stock: Boolean(data.allow_negative_stock),
    });
  }

  if (isLoading) return <div className="text-slate-400 py-4">{t("common.loading")}</div>;

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6 max-w-xl">
      {toast && <Toast message={toast.msg} type={toast.type} />}

      {/* Stock Policy */}
      <div className="space-y-3">
        <h3 className="text-sm font-bold text-slate-900">Politique de Stock & Caisse</h3>
        <div className="p-4 rounded-2xl border border-slate-200/80 bg-slate-50/50">
          <div className="flex items-start gap-3">
            <input
              type="checkbox"
              id="allow_negative_stock"
              {...register("allow_negative_stock")}
              className="w-4 h-4 mt-0.5 accent-primary-600 rounded border-slate-300"
            />
            <div>
              <label
                htmlFor="allow_negative_stock"
                className="text-sm font-semibold text-slate-900 cursor-pointer"
              >
                Autoriser les ventes en stock négatif
              </label>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                Permet d'effectuer des ventes même si la quantité en stock est insuffisante ou épuisée.
                Une alerte de confirmation sera affichée au caissier avant de valider la vente.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Versements Policy */}
      <div className="pt-6 border-t border-slate-200/80 space-y-4">
        <h3 className="text-sm font-bold text-slate-900">Paramètres de Versement (Crédit)</h3>

        <div>
          <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
            Acompte minimum (%) <span className="text-rose-500">*</span>
          </label>
          <input
            type="number"
            min={1}
            max={100}
            {...register("min_versement_pct", { required: "Obligatoire", min: 1, max: 100 })}
            className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-4 focus:ring-primary-500/10 transition-all font-mono"
          />
          <p className="text-xs text-slate-500 mt-1">
            Pourcentage du total de la vente requis comme premier paiement à la caisse.
          </p>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
            Délai de paiement (jours) <span className="text-rose-500">*</span>
          </label>
          <input
            type="number"
            min={1}
            {...register("versement_due_days", { required: "Obligatoire", min: 1 })}
            className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-4 focus:ring-primary-500/10 transition-all font-mono"
          />
          <p className="text-xs text-slate-500 mt-1">
            Nombre de jours accordés avant qu'une échéance soit marquée en retard.
          </p>
        </div>

        <div className="p-3.5 rounded-xl border border-slate-200/80 bg-slate-50/50 flex items-center gap-3">
          <input
            type="checkbox"
            id="versement_requires_client"
            {...register("versement_requires_client")}
            className="w-4 h-4 accent-primary-600 rounded border-slate-300"
          />
          <label
            htmlFor="versement_requires_client"
            className="text-sm font-medium text-slate-800 cursor-pointer"
          >
            Exiger la sélection d'un client enregistré pour les ventes à crédit
          </label>
        </div>
      </div>

      <div className="flex items-center justify-end pt-4 border-t border-slate-100">
        <button
          type="submit"
          disabled={mutation.isPending || !isDirty}
          className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-primary-600 hover:bg-primary-700 text-white text-xs font-semibold shadow-xs shadow-primary-500/20 disabled:opacity-50 transition-all cursor-pointer"
        >
          {mutation.isPending ? t("common.saving") : t("common.save")}
        </button>
      </div>
    </form>
  );
}

// ─── Main SettingsPage ───────────────────────────────────────────────────

type TabKey =
  | "profil"
  | "boutique"
  | "securite"
  | "utilisateurs"
  | "agences"
  | "versements"
  | "deliveries"
  | "imprimantes"
  | "migration"
  | "desktop";

interface Tab {
  key: TabKey;
  label: string;
  icon: LucideIcon;
  roles?: string[];
}

const TABS: Tab[] = [
  { key: "profil", label: t("settings.profile"), icon: User },
  { key: "boutique", label: t("settings.store"), icon: Building2, roles: ["owner", "manager"] },
  { key: "securite", label: "Sécurité", icon: Shield },
  { key: "utilisateurs", label: t("settings.users"), icon: Users, roles: ["owner", "manager"] },
  { key: "agences", label: "Agences", icon: MapPin, roles: ["owner", "manager"] },
  { key: "versements", label: "Ventes & Versements", icon: Banknote, roles: ["owner"] },
  { key: "deliveries", label: t("nav.delivery_settings"), icon: Truck, roles: ["owner", "manager"] },
  { key: "imprimantes", label: "Imprimantes", icon: Printer, roles: ["owner", "manager"] },
  { key: "migration", label: t("settings.tab_migration"), icon: Database, roles: ["owner", "manager"] },
  { key: "desktop", label: t("settings.tab_desktop", "Sauvegardes & Application"), icon: HardDrive, roles: ["owner", "manager"] },
];

export default function SettingsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<TabKey>("profil");

  // Fetch tenant data for boutique tab
  const { data: tenantData } = useQuery<Tenant>({
    queryKey: ["tenant", user?.tenant?.id],
    queryFn: () => api.get("/core/tenant/settings/").then((r) => r.data),
    enabled: !!user?.tenant?.id && activeTab === "boutique",
  });

  const visibleTabs = TABS.filter(
    (t) => !t.roles || (user && t.roles.includes(user.role))
  );

  if (!user) return null;

  const tenant = tenantData ?? user.tenant;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">{t("nav.settings")}</h1>
        <p className="text-sm text-slate-500 mt-1">
          Gérez votre profil, vos agences, les comptes utilisateurs et la configuration de votre système
        </p>
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* Sidebar nav */}
        <div className="lg:w-64 flex-shrink-0">
          <div className="rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden bg-white p-2">
            <nav className="space-y-1">
              {visibleTabs.map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.key;
                return (
                  <button
                    key={tab.key}
                    onClick={() => setActiveTab(tab.key)}
                    className={cn(
                      "w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all text-left cursor-pointer",
                      isActive
                        ? "bg-primary-50 text-primary-700 border border-primary-200/60 shadow-2xs"
                        : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
                    )}
                  >
                    <Icon
                      size={16}
                      className={cn(isActive ? "text-primary-600" : "text-slate-400")}
                    />
                    <span className="truncate">{tab.label}</span>
                  </button>
                );
              })}
            </nav>
          </div>
        </div>

        {/* Tab content */}
        <div className="flex-1 min-w-0">
          <div className="rounded-2xl border border-slate-200/80 shadow-xs bg-white p-6 sm:p-8">
            <h2 className="text-lg font-bold text-slate-900 pb-4 mb-6 border-b border-slate-100 flex items-center gap-2.5">
              {(() => {
                const current = visibleTabs.find((t) => t.key === activeTab);
                if (!current) return null;
                const CurrentIcon = current.icon;
                return (
                  <>
                    <CurrentIcon size={20} className="text-primary-600" />
                    <span>{current.label}</span>
                  </>
                );
              })()}
            </h2>

            {activeTab === "profil" && <ProfileTab user={user} />}

            {activeTab === "boutique" &&
              (tenant ? (
                <BoutiqueTab tenant={tenant as Tenant} />
              ) : (
                <div className="text-slate-400 py-4">Chargement des informations boutique...</div>
              ))}

            {activeTab === "securite" && <SecurityTab />}

            {activeTab === "utilisateurs" && <UsersTab />}

            {activeTab === "agences" && <AgencesTab />}

            {activeTab === "versements" && <VersementsTab />}

            {activeTab === "deliveries" && <DeliverySettingsTab />}

            {activeTab === "imprimantes" && <PrintersTab />}

            {activeTab === "migration" && <LegacyImportSection />}

            {activeTab === "desktop" && <DesktopTab />}
          </div>
        </div>
      </div>
    </div>
  );
}
