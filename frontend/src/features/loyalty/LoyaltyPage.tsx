/**
 * LoyaltyPage — /loyalty
 *
 * Tab 1 "Programme" — config form + stats + leaderboard
 * Tab 2 "Comptes"   — searchable/filterable accounts table with adjust modal
 */
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import {
  Gift,
  Settings,
  Trophy,
  Users,
  Medal,
  Star,
  Zap,
  AlertCircle,
  Search,
  ChevronLeft,
  ChevronRight,
  PlusCircle,
  X,
} from "lucide-react";
import api, { formatDate, getApiError, type PaginatedResponse } from "@/lib/api";
import type { LoyaltyAccountSummary, LoyaltyProgram } from "@/types";
import { cn } from "@/lib/utils";
import { useAuth } from "@/features/auth/AuthContext";

// ── Tier helpers ──────────────────────────────────────────────────────────

const TIER_CONFIG = {
  bronze: { label: "Bronze", colour: "text-amber-700 bg-amber-100 border-amber-300", icon: Medal },
  silver: { label: "Argent", colour: "text-slate-600 bg-slate-100 border-slate-300", icon: Star },
  gold:   { label: "Or",     colour: "text-yellow-700 bg-yellow-100 border-yellow-400", icon: Trophy },
} as const;

function TierBadge({ tier }: { tier: "bronze" | "silver" | "gold" }) {
  const cfg = TIER_CONFIG[tier];
  const Icon = cfg.icon;
  return (
    <span className={cn(
      "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border",
      cfg.colour,
    )}>
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
  silver_threshold: number;
  gold_threshold: number;
  silver_multiplier: number;
  gold_multiplier: number;
  expiry_months: string;
  is_active: boolean;
}

function ProgramPanel({ program }: { program: LoyaltyProgram | null }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const isOwner = user?.role === "owner";
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  const { register, handleSubmit, watch, formState: { errors, isDirty } } = useForm<ProgramFormData>({
    defaultValues: program
      ? {
          points_per_100dzd: program.points_per_100dzd,
          redemption_value: program.redemption_value,
          min_redemption_points: program.min_redemption_points,
          silver_threshold: program.silver_threshold,
          gold_threshold: program.gold_threshold,
          silver_multiplier: parseFloat(program.silver_multiplier),
          gold_multiplier: parseFloat(program.gold_multiplier),
          expiry_months: program.expiry_months?.toString() ?? "",
          is_active: program.is_active,
        }
      : {
          points_per_100dzd: 1,
          redemption_value: 100,
          min_redemption_points: 500,
          silver_threshold: 5000,
          gold_threshold: 15000,
          silver_multiplier: 1.2,
          gold_multiplier: 1.5,
          expiry_months: "",
          is_active: true,
        },
  });

  const [silverThreshold, goldThreshold, silverMultiplier, goldMultiplier] =
    watch(["silver_threshold", "gold_threshold", "silver_multiplier", "gold_multiplier"]);

  const mutation = useMutation({
    mutationFn: (data: ProgramFormData) => {
      const payload = { ...data, expiry_months: data.expiry_months ? parseInt(data.expiry_months) : null };
      if (program) return api.patch(`/loyalty/programs/${program.id}/`, payload).then((r) => r.data);
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
            program.is_active ? "bg-success-light text-success" : "bg-danger-light text-danger",
          )}>
            {program.is_active ? "Actif" : "Inactif"}
          </span>
        )}
      </div>

      {toast && (
        <div className={cn(
          "mb-4 rounded-lg px-4 py-2.5 text-sm font-medium",
          toast.type === "success" ? "bg-success-light text-success" : "bg-danger-light text-danger",
        )}>
          {toast.msg}
        </div>
      )}

      <form onSubmit={handleSubmit((d) => mutation.mutate(d))} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="form-label">Points par 100 DZD dépensés</label>
            <input type="number" min={1}
              {...register("points_per_100dzd", { required: true, valueAsNumber: true, min: 1 })}
              className="form-input" disabled={!isOwner} />
            {errors.points_per_100dzd && <p className="form-error">Requis (min 1)</p>}
          </div>
          <div>
            <label className="form-label">Points pour obtenir 100 DZD de remise</label>
            <input type="number" min={1}
              {...register("redemption_value", { required: true, valueAsNumber: true, min: 1 })}
              className="form-input" disabled={!isOwner} />
            {errors.redemption_value && <p className="form-error">Requis (min 1)</p>}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="form-label">Minimum de points pour racheter</label>
            <input type="number" min={0}
              {...register("min_redemption_points", { required: true, valueAsNumber: true, min: 0 })}
              className="form-input" disabled={!isOwner} />
          </div>
          <div>
            <label className="form-label">Expiration (mois, vide = jamais)</label>
            <input type="number" min={1} placeholder="Jamais"
              {...register("expiry_months")}
              className="form-input" disabled={!isOwner} />
          </div>
        </div>

        <div className="border border-border rounded-xl p-4 space-y-3">
          <p className="text-xs font-semibold text-text-primary flex items-center gap-1.5">
            <Zap size={12} /> Niveaux de fidélité
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="form-label">Seuil Argent (pts cumulés)</label>
              <input type="number" min={1}
                {...register("silver_threshold", { required: true, valueAsNumber: true, min: 1 })}
                className="form-input" disabled={!isOwner} />
            </div>
            <div>
              <label className="form-label">Multiplicateur Argent</label>
              <input type="number" min={1} step={0.01}
                {...register("silver_multiplier", { required: true, valueAsNumber: true, min: 1 })}
                className="form-input" disabled={!isOwner} />
            </div>
            <div>
              <label className="form-label">Seuil Or (pts cumulés)</label>
              <input type="number" min={1}
                {...register("gold_threshold", { required: true, valueAsNumber: true, min: 1 })}
                className="form-input" disabled={!isOwner} />
            </div>
            <div>
              <label className="form-label">Multiplicateur Or</label>
              <input type="number" min={1} step={0.01}
                {...register("gold_multiplier", { required: true, valueAsNumber: true, min: 1 })}
                className="form-input" disabled={!isOwner} />
            </div>
          </div>
          <div className="rounded-lg bg-primary-50 border border-primary-100 p-3 text-xs text-primary-700 space-y-1">
            <p>🥉 <strong>Bronze</strong> — 0 pts — ×1</p>
            <p>🥈 <strong>Argent</strong> — {(silverThreshold || 5000).toLocaleString("fr-DZ")} pts — ×{silverMultiplier || 1.2}</p>
            <p>🥇 <strong>Or</strong> — {(goldThreshold || 15000).toLocaleString("fr-DZ")} pts — ×{goldMultiplier || 1.5}</p>
          </div>
        </div>

        <label className="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" {...register("is_active")}
            className="w-4 h-4 accent-primary-500" disabled={!isOwner} />
          <span className="text-sm text-text-primary">Programme actif</span>
        </label>

        {isOwner && (
          <button type="submit" className="btn-primary w-full"
            disabled={mutation.isPending || !isDirty}>
            {mutation.isPending ? "Enregistrement…" : program ? "Mettre à jour" : "Créer le programme"}
          </button>
        )}
      </form>
    </div>
  );
}

// ── Leaderboard ───────────────────────────────────────────────────────────

function Leaderboard({ accounts }: { accounts: LoyaltyAccountSummary[] }) {
  return (
    <div className="card">
      <div className="flex items-center gap-3 mb-5">
        <div className="w-9 h-9 rounded-lg bg-yellow-50 flex items-center justify-center">
          <Trophy size={18} className="text-yellow-500" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-text-primary">Classement clients</h2>
          <p className="text-xs text-text-muted">Top 20 par points cumulés</p>
        </div>
      </div>

      {accounts.length === 0 ? (
        <div className="text-center py-10 text-text-muted text-sm">
          <Users size={36} className="mx-auto mb-3 opacity-30" />
          Aucun client inscrit au programme.
        </div>
      ) : (
        <div className="space-y-1.5">
          {accounts.map((acc, idx) => (
            <div key={acc.id}
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-surface transition-colors">
              <span className={cn(
                "w-6 h-6 flex items-center justify-center rounded-full text-xs font-bold flex-shrink-0",
                idx === 0 ? "bg-yellow-100 text-yellow-700" :
                idx === 1 ? "bg-slate-100 text-slate-600" :
                idx === 2 ? "bg-amber-100 text-amber-700" :
                "bg-surface text-text-muted",
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

function StatsStrip({ accounts }: { accounts: LoyaltyAccountSummary[] }) {
  const total = accounts.length;
  const byTier = accounts.reduce<Record<string, number>>(
    (acc, a) => ({ ...acc, [a.tier]: (acc[a.tier] ?? 0) + 1 }),
    {},
  );
  const totalPts = accounts.reduce((s, a) => s + a.points_balance, 0);

  const stats = [
    { label: "Clients inscrits",     value: total,                  icon: Users,   colour: "text-primary-500 bg-primary-50" },
    { label: "Points en circulation", value: totalPts.toLocaleString(), icon: Gift, colour: "text-success bg-success-light" },
    { label: "Clients Or",           value: byTier["gold"] ?? 0,    icon: Trophy,  colour: "text-yellow-600 bg-yellow-50" },
    { label: "Clients Argent",       value: byTier["silver"] ?? 0,  icon: Star,    colour: "text-slate-500 bg-slate-100" },
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

// ── Adjust modal ──────────────────────────────────────────────────────────

function AdjustModal({
  account,
  onClose,
}: {
  account: LoyaltyAccountSummary;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [points, setPoints] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      api.post(`/loyalty/accounts/${account.id}/adjust/`, {
        points: parseInt(points),
        description,
      }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["loyalty-accounts"] });
      onClose();
    },
    onError: (err) => setError(getApiError(err)),
  });

  const pts = parseInt(points) || 0;
  const newBalance = account.points_balance + pts;
  const isValid = points !== "" && pts !== 0 && newBalance >= 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div>
            <h3 className="font-semibold text-text-primary">Ajuster les points</h3>
            <p className="text-xs text-text-muted mt-0.5">{account.client_name}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface transition-colors">
            <X size={18} className="text-text-muted" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex items-center justify-between rounded-xl bg-surface p-3">
            <div>
              <p className="text-xs text-text-muted">Solde actuel</p>
              <p className="text-lg font-bold text-text-primary">
                {account.points_balance.toLocaleString()} pts
              </p>
            </div>
            <TierBadge tier={account.tier} />
          </div>

          <div>
            <label className="form-label">Points à ajouter / retirer</label>
            <input
              type="number"
              value={points}
              onChange={(e) => setPoints(e.target.value)}
              placeholder="+100 ou -50"
              className="form-input"
              autoFocus
            />
            <p className="text-xs text-text-muted mt-1">Positif pour ajouter, négatif pour retirer.</p>
          </div>

          <div>
            <label className="form-label">
              Raison <span className="text-text-muted font-normal">(optionnel)</span>
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Ex : correction erreur, geste commercial…"
              className="form-input"
            />
          </div>

          {pts !== 0 && (
            <div className={cn(
              "rounded-xl p-3 text-sm font-medium",
              newBalance < 0
                ? "bg-danger-light text-danger"
                : pts > 0 ? "bg-success-light text-success" : "bg-amber-50 text-amber-700",
            )}>
              {newBalance < 0
                ? "Solde insuffisant pour ce retrait."
                : `Nouveau solde : ${newBalance.toLocaleString()} pts`}
            </div>
          )}

          {error && (
            <p className="text-sm text-danger bg-danger-light rounded-lg px-3 py-2">{error}</p>
          )}
        </div>

        <div className="flex gap-3 p-5 pt-0">
          <button onClick={onClose} className="btn-secondary flex-1">Annuler</button>
          <button
            onClick={() => mutation.mutate()}
            disabled={!isValid || mutation.isPending}
            className="btn-primary flex-1"
          >
            {mutation.isPending ? "Enregistrement…" : "Confirmer"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Accounts panel ────────────────────────────────────────────────────────

type TierFilter = "all" | "bronze" | "silver" | "gold";

function AccountsPanel() {
  const { user } = useAuth();
  const isManager = user?.role === "owner" || user?.role === "manager";

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [tierFilter, setTierFilter] = useState<TierFilter>("all");
  const [page, setPage] = useState(1);
  const [adjustAccount, setAdjustAccount] = useState<LoyaltyAccountSummary | null>(null);

  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(search); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const params = new URLSearchParams({ ordering: "-total_earned", page_size: "20", page: String(page) });
  if (debouncedSearch) params.set("search", debouncedSearch);
  if (tierFilter !== "all") params.set("tier", tierFilter);

  const { data, isLoading } = useQuery<PaginatedResponse<LoyaltyAccountSummary>>({
    queryKey: ["loyalty-accounts", debouncedSearch, tierFilter, page],
    queryFn: () => api.get(`/loyalty/accounts/?${params}`).then((r) => r.data),
  });

  const accounts = data?.results ?? [];
  const totalCount = data?.count ?? 0;
  const totalPages = Math.ceil(totalCount / 20);

  const TIERS: { value: TierFilter; label: string }[] = [
    { value: "all",    label: "Tous" },
    { value: "gold",   label: "Or" },
    { value: "silver", label: "Argent" },
    { value: "bronze", label: "Bronze" },
  ];

  return (
    <div className="card">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher un client…"
            className="form-input pl-9"
          />
        </div>
        <div className="flex gap-1.5">
          {TIERS.map((t) => (
            <button
              key={t.value}
              onClick={() => { setTierFilter(t.value); setPage(1); }}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors",
                tierFilter === t.value
                  ? "bg-primary-500 text-white border-primary-500"
                  : "bg-white text-text-secondary border-border hover:border-primary-300",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <p className="text-xs text-text-muted mb-3">
        {isLoading ? "Chargement…" : `${totalCount} compte${totalCount !== 1 ? "s" : ""}`}
      </p>

      {isLoading ? (
        <div className="text-center py-12 text-text-muted text-sm">Chargement…</div>
      ) : accounts.length === 0 ? (
        <div className="text-center py-12 text-text-muted text-sm">
          <Users size={36} className="mx-auto mb-3 opacity-30" />
          Aucun compte trouvé.
        </div>
      ) : (
        <div className="overflow-x-auto -mx-5">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left text-xs font-semibold text-text-muted px-5 py-2.5">Client</th>
                <th className="text-left text-xs font-semibold text-text-muted px-3 py-2.5">Niveau</th>
                <th className="text-right text-xs font-semibold text-text-muted px-3 py-2.5">Solde</th>
                <th className="text-right text-xs font-semibold text-text-muted px-3 py-2.5">Cumulés</th>
                <th className="text-left text-xs font-semibold text-text-muted px-3 py-2.5">Inscrit le</th>
                {isManager && <th className="px-5 py-2.5" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {accounts.map((acc) => (
                <tr key={acc.id} className="hover:bg-surface transition-colors">
                  <td className="px-5 py-3">
                    <p className="font-medium text-text-primary">{acc.client_name}</p>
                    <p className="text-xs text-text-muted">{acc.client_phone}</p>
                  </td>
                  <td className="px-3 py-3">
                    <TierBadge tier={acc.tier} />
                    {acc.next_tier && acc.points_to_next_tier != null && (
                      <p className="text-xs text-text-muted mt-1">
                        {acc.points_to_next_tier.toLocaleString()} pts → {TIER_CONFIG[acc.next_tier].label}
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right">
                    <span className="font-bold text-primary-600">{acc.points_balance.toLocaleString()}</span>
                    <span className="text-xs text-text-muted"> pts</span>
                  </td>
                  <td className="px-3 py-3 text-right">
                    <span className="text-text-secondary">{acc.total_earned.toLocaleString()}</span>
                    <span className="text-xs text-text-muted"> pts</span>
                  </td>
                  <td className="px-3 py-3 text-text-muted text-xs">{formatDate(acc.enrolled_at)}</td>
                  {isManager && (
                    <td className="px-5 py-3 text-right">
                      <button
                        onClick={() => setAdjustAccount(acc)}
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-primary-600 hover:text-primary-700 hover:bg-primary-50 px-2.5 py-1.5 rounded-lg transition-colors"
                      >
                        <PlusCircle size={13} />
                        Ajuster
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 pt-4 border-t border-border">
          <p className="text-xs text-text-muted">Page {page} / {totalPages}</p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="p-1.5 rounded-lg border border-border hover:bg-surface disabled:opacity-40 transition-colors"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="p-1.5 rounded-lg border border-border hover:bg-surface disabled:opacity-40 transition-colors"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}

      {adjustAccount && (
        <AdjustModal account={adjustAccount} onClose={() => setAdjustAccount(null)} />
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────

type Tab = "programme" | "comptes";

export default function LoyaltyPage() {
  const [tab, setTab] = useState<Tab>("programme");

  const { data: programData } = useQuery<{ results: LoyaltyProgram[] }>({
    queryKey: ["loyalty-program"],
    queryFn: () => api.get("/loyalty/programs/").then((r) => r.data),
  });

  const { data: accountsData } = useQuery<PaginatedResponse<LoyaltyAccountSummary>>({
    queryKey: ["loyalty-accounts", "", "all", 1],
    queryFn: () =>
      api.get("/loyalty/accounts/?ordering=-total_earned&page_size=20").then((r) => r.data),
  });

  const program = programData?.results?.[0] ?? null;
  const accounts = accountsData?.results ?? [];

  const TABS: { key: Tab; label: string; icon: typeof Settings }[] = [
    { key: "programme", label: "Programme", icon: Settings },
    { key: "comptes",   label: "Comptes",   icon: Users },
  ];

  return (
    <div className="max-w-5xl mx-auto">
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

      {/* Tab bar */}
      <div className="flex gap-1 mb-5 bg-surface rounded-xl p-1 w-fit">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
              tab === key
                ? "bg-white text-text-primary shadow-sm"
                : "text-text-muted hover:text-text-secondary",
            )}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </div>

      {tab === "programme" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <ProgramPanel program={program} />
          <Leaderboard accounts={accounts} />
        </div>
      )}

      {tab === "comptes" && <AccountsPanel />}
    </div>
  );
}
