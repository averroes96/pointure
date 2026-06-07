/**
 * LoyaltyPage — /loyalty
 *
 * Two panels:
 *   Left  — Programme settings (owner-only edit)
 *   Right — Top enrolled clients ranked by points
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import {
  Gift,
  Settings,
  Trophy,
  TrendingUp,
  Users,
  Medal,
  Star,
  Zap,
  AlertCircle,
} from "lucide-react";
import api, { formatDate, getApiError, type PaginatedResponse } from "@/lib/api";
import type { LoyaltyAccount, LoyaltyProgram } from "@/types";
import { cn } from "@/lib/utils";
import { useAuth } from "@/features/auth/AuthContext";

// ── Tier helpers ──────────────────────────────────────────────────────────

const TIER_CONFIG = {
  bronze: { label: "Bronze", colour: "text-amber-700 bg-amber-100 border-amber-300", icon: Medal },
  silver: { label: "Argent", colour: "text-slate-600 bg-slate-100 border-slate-300", icon: Star },
  gold: { label: "Or", colour: "text-yellow-700 bg-yellow-100 border-yellow-400", icon: Trophy },
} as const;

function TierBadge({ tier }: { tier: "bronze" | "silver" | "gold" }) {
  const cfg = TIER_CONFIG[tier];
  const Icon = cfg.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border",
        cfg.colour
      )}
    >
      <Icon size={11} />
      {cfg.label}
    </span>
  );
}

// ── Program form ──────────────────────────────────────────────────────────

interface ProgramFormData {
  points_per_100dzd: number;
  redemption_value: number;
  min_redemption_points: number;
  expiry_months: string;
  is_active: boolean;
}

function ProgramPanel({ program }: { program: LoyaltyProgram | null }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const isOwner = user?.role === "owner";
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  const { register, handleSubmit, formState: { errors, isDirty } } = useForm<ProgramFormData>({
    defaultValues: program
      ? {
          points_per_100dzd: program.points_per_100dzd,
          redemption_value: program.redemption_value,
          min_redemption_points: program.min_redemption_points,
          expiry_months: program.expiry_months?.toString() ?? "",
          is_active: program.is_active,
        }
      : {
          points_per_100dzd: 1,
          redemption_value: 100,
          min_redemption_points: 500,
          expiry_months: "",
          is_active: true,
        },
  });

  const mutation = useMutation({
    mutationFn: (data: ProgramFormData) => {
      const payload = {
        ...data,
        expiry_months: data.expiry_months ? parseInt(data.expiry_months) : null,
      };
      if (program) {
        return api.patch(`/loyalty/programs/${program.id}/`, payload).then((r) => r.data);
      }
      return api.post("/loyalty/programs/", payload).then((r) => r.data);
    },
    onSuccess: () => {
      setToast({ msg: "Programme mis à jour.", type: "success" });
      qc.invalidateQueries({ queryKey: ["loyalty-program"] });
    },
    onError: (err) => setToast({ msg: getApiError(err), type: "error" }),
  });

  return (
    <div className="card">
      <div className="flex items-center gap-3 mb-5">
        <div className="w-9 h-9 rounded-lg bg-primary-50 flex items-center justify-center">
          <Settings size={18} className="text-primary-500" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-text-primary">Configuration du programme</h2>
          <p className="text-xs text-text-muted">Règles d'accumulation et de rachat</p>
        </div>
        {program && (
          <span className={cn(
            "ml-auto text-xs font-medium px-2.5 py-1 rounded-full",
            program.is_active
              ? "bg-success-light text-success"
              : "bg-danger-light text-danger"
          )}>
            {program.is_active ? "Actif" : "Inactif"}
          </span>
        )}
      </div>

      {toast && (
        <div className={cn(
          "mb-4 rounded-lg px-4 py-2.5 text-sm font-medium",
          toast.type === "success"
            ? "bg-success-light text-success"
            : "bg-danger-light text-danger"
        )}>
          {toast.msg}
        </div>
      )}

      <form onSubmit={handleSubmit((d) => mutation.mutate(d))} className="space-y-4">
        {/* Earn rate */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="form-label">Points par 100 DZD dépensés</label>
            <input
              type="number"
              min={1}
              {...register("points_per_100dzd", { required: true, valueAsNumber: true, min: 1 })}
              className="form-input"
              disabled={!isOwner}
            />
            {errors.points_per_100dzd && <p className="form-error">Requis (min 1)</p>}
          </div>
          <div>
            <label className="form-label">Points pour obtenir 100 DZD de remise</label>
            <input
              type="number"
              min={1}
              {...register("redemption_value", { required: true, valueAsNumber: true, min: 1 })}
              className="form-input"
              disabled={!isOwner}
            />
            {errors.redemption_value && <p className="form-error">Requis (min 1)</p>}
          </div>
        </div>

        {/* Min redemption */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="form-label">Minimum de points pour racheter</label>
            <input
              type="number"
              min={0}
              {...register("min_redemption_points", { required: true, valueAsNumber: true, min: 0 })}
              className="form-input"
              disabled={!isOwner}
            />
          </div>
          <div>
            <label className="form-label">Expiration (mois, vide = jamais)</label>
            <input
              type="number"
              min={1}
              placeholder="Jamais"
              {...register("expiry_months")}
              className="form-input"
              disabled={!isOwner}
            />
          </div>
        </div>

        {/* Active toggle */}
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            {...register("is_active")}
            className="w-4 h-4 accent-primary-500"
            disabled={!isOwner}
          />
          <span className="text-sm text-text-primary">Programme actif</span>
        </label>

        {/* Summary box */}
        <div className="rounded-xl bg-primary-50 border border-primary-100 p-4 text-xs text-primary-700 space-y-1.5">
          <p className="font-semibold text-primary-800 flex items-center gap-1.5">
            <Zap size={13} /> Niveaux de fidélité
          </p>
          <p>🥉 <strong>Bronze</strong> — 0 pts cumulés — multiplicateur ×1</p>
          <p>🥈 <strong>Argent</strong> — 5 000 pts cumulés — multiplicateur ×1.2</p>
          <p>🥇 <strong>Or</strong> — 15 000 pts cumulés — multiplicateur ×1.5</p>
        </div>

        {isOwner && (
          <button
            type="submit"
            className="btn-primary w-full"
            disabled={mutation.isPending || !isDirty}
          >
            {mutation.isPending ? "Enregistrement…" : program ? "Mettre à jour" : "Créer le programme"}
          </button>
        )}
      </form>
    </div>
  );
}

// ── Client leaderboard ────────────────────────────────────────────────────

function Leaderboard({ accounts }: { accounts: LoyaltyAccount[] }) {
  return (
    <div className="card">
      <div className="flex items-center gap-3 mb-5">
        <div className="w-9 h-9 rounded-lg bg-yellow-50 flex items-center justify-center">
          <Trophy size={18} className="text-yellow-500" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-text-primary">Classement clients</h2>
          <p className="text-xs text-text-muted">Triés par points cumulés (lifetime)</p>
        </div>
      </div>

      {accounts.length === 0 ? (
        <div className="text-center py-10 text-text-muted text-sm">
          <Users size={36} className="mx-auto mb-3 opacity-30" />
          Aucun client inscrit au programme.
        </div>
      ) : (
        <div className="space-y-2">
          {accounts.map((acc, idx) => (
            <div
              key={acc.id}
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-surface transition-colors"
            >
              <span className={cn(
                "w-6 h-6 flex items-center justify-center rounded-full text-xs font-bold flex-shrink-0",
                idx === 0 ? "bg-yellow-100 text-yellow-700" :
                idx === 1 ? "bg-slate-100 text-slate-600" :
                idx === 2 ? "bg-amber-100 text-amber-700" :
                "bg-surface text-text-muted"
              )}>
                {idx + 1}
              </span>

              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-text-primary truncate">{acc.client_name}</p>
                <p className="text-xs text-text-muted">{acc.client_phone}</p>
              </div>

              <div className="text-right flex-shrink-0">
                <p className="text-sm font-bold text-primary-600">{acc.points_balance.toLocaleString()} pts</p>
                <TierBadge tier={acc.tier} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Stats strip ───────────────────────────────────────────────────────────

function StatsStrip({ accounts }: { accounts: LoyaltyAccount[] }) {
  const total = accounts.length;
  const byTier = accounts.reduce<Record<string, number>>(
    (acc, a) => ({ ...acc, [a.tier]: (acc[a.tier] ?? 0) + 1 }),
    {}
  );
  const totalPts = accounts.reduce((s, a) => s + a.points_balance, 0);

  const stats = [
    { label: "Clients inscrits", value: total, icon: Users, colour: "text-primary-500 bg-primary-50" },
    { label: "Points en circulation", value: totalPts.toLocaleString(), icon: Gift, colour: "text-success bg-success-light" },
    { label: "Clients Or", value: byTier["gold"] ?? 0, icon: Trophy, colour: "text-yellow-600 bg-yellow-50" },
    { label: "Clients Argent", value: byTier["silver"] ?? 0, icon: Star, colour: "text-slate-500 bg-slate-100" },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
      {stats.map((s) => {
        const Icon = s.icon;
        return (
          <div key={s.label} className="card p-4 flex items-center gap-3">
            <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0", s.colour)}>
              <Icon size={18} />
            </div>
            <div className="min-w-0">
              <p className="text-lg font-bold text-text-primary leading-tight">{s.value}</p>
              <p className="text-xs text-text-muted">{s.label}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────

export default function LoyaltyPage() {
  const { data: programData } = useQuery<{ results: LoyaltyProgram[] }>({
    queryKey: ["loyalty-program"],
    queryFn: () => api.get("/loyalty/programs/").then((r) => r.data),
  });

  const { data: accountsData } = useQuery<PaginatedResponse<LoyaltyAccount>>({
    queryKey: ["loyalty-accounts"],
    queryFn: () =>
      api.get("/loyalty/accounts/?ordering=-total_earned&page_size=20").then((r) => r.data),
  });

  const program = programData?.results?.[0] ?? null;
  const accounts = accountsData?.results ?? [];

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center shadow-sm">
          <Gift size={20} className="text-white" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-text-primary">Programme de fidélité</h1>
          <p className="text-sm text-text-muted">Gérez les points et les niveaux de vos clients</p>
        </div>
        {!program && (
          <div className="ml-auto flex items-center gap-2 text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs font-medium">
            <AlertCircle size={14} />
            Aucun programme configuré
          </div>
        )}
      </div>

      <StatsStrip accounts={accounts} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <ProgramPanel program={program} />
        <Leaderboard accounts={accounts} />
      </div>
    </div>
  );
}
