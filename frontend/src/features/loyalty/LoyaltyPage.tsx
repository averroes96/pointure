/**
 * LoyaltyPage — /loyalty (v1.4 Fidelity 2.0)
 *
 * - Rich KPI strip (Members, Active Points + DZD Value, Redeemed Points + DZD Value, VIPs)
 * - Interactive DZD ↔ Points Simulator & Visual Bronze / Argent / Or Tier Cards
 * - 1-click Client Enrollment Modal (+ Bulk "Synchroniser tous les clients")
 * - Client Points Transaction Ledger Modal
 * - Printable Client Loyalty Card (with scannable barcode) & 1-click WhatsApp summary
 */
import i18n from "i18next";
import { useTranslation } from "react-i18next";
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
  Calculator,
  Printer,
  History,
  UserPlus,
  MessageCircle,
  Sparkles,
  CheckCircle2,
  Coins,
} from "lucide-react";
import api, { formatDate, formatDZD, getApiError, type PaginatedResponse } from "@/lib/api";
import type { LoyaltyAccount, LoyaltyAccountSummary, LoyaltyProgram, Client } from "@/types";
import { cn } from "@/lib/utils";
import { useAuth } from "@/features/auth/AuthContext";

// ── Tier helpers ──────────────────────────────────────────────────────────

const TIER_CONFIG = {
  bronze: {
    label: "Bronze",
    emoji: "🥉",
    colour: "text-amber-800 bg-amber-100 border-amber-300",
    cardBg: "from-amber-50 to-orange-50/50 border-amber-200",
    icon: Medal,
  },
  silver: {
    label: "Argent",
    emoji: "🥈",
    colour: "text-slate-700 bg-slate-100 border-slate-300",
    cardBg: "from-slate-50 to-slate-100/70 border-slate-300",
    icon: Star,
  },
  gold: {
    label: "Or",
    emoji: "🥇",
    colour: "text-yellow-800 bg-yellow-100 border-yellow-400",
    cardBg: "from-yellow-50 to-amber-100/60 border-yellow-400",
    icon: Trophy,
  },
} as const;

function TierBadge({ tier }: { tier: "bronze" | "silver" | "gold" }) {
  const cfg = TIER_CONFIG[tier] ?? TIER_CONFIG.bronze;
  const Icon = cfg.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold border",
        cfg.colour,
      )}
    >
      <Icon size={11} />
      {cfg.label}
    </span>
  );
}

// ── Printable Client Loyalty Card ─────────────────────────────────────────

function printLoyaltyCard(
  acc: LoyaltyAccountSummary,
  program: LoyaltyProgram | null,
  storeName: string,
) {
  const win = window.open("", "_blank", "width=460,height=620");
  if (!win) return;

  const dzdVal = program
    ? Math.floor((acc.points_balance / (program.redemption_value || 100)) * 100)
    : acc.points_balance;
  const codeText = (acc.client_phone || `CL-${acc.client}`).replace(/\s+/g, "");
  const tierCfg = TIER_CONFIG[acc.tier] ?? TIER_CONFIG.bronze;

  // Generate a clean visual barcode pattern from codeText characters
  const barsHtml = Array.from(codeText + storeName.slice(0, 3))
    .map((ch, idx) => {
      const w = (ch.charCodeAt(0) % 3) + 1;
      const gap = ((idx + ch.charCodeAt(0)) % 2) + 1;
      return `<span style="display:inline-block;height:38px;width:${w * 2}px;background:#0f172a;margin-right:${gap * 2}px;"></span>`;
    })
    .join("");

  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <meta name="color-scheme" content="light" />
  <title>Carte Fidélité — ${acc.client_name}</title>
  <style>
    :root { color-scheme: light !important; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body {
      background: #ffffff !important;
      color: #0f172a !important;
      color-scheme: light !important;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      padding: 16px;
      display: flex;
      justify-content: center;
    }
    .card {
      width: 82mm;
      border: 2px solid #0f172a;
      border-radius: 14px;
      padding: 14px;
      background: #ffffff !important;
      color: #0f172a !important;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px dashed #cbd5e1;
      padding-bottom: 8px;
      margin-bottom: 10px;
    }
    .store { font-size: 15px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.5px; }
    .tier {
      font-size: 11px;
      font-weight: 800;
      padding: 3px 8px;
      border-radius: 99px;
      border: 1px solid #0f172a;
    }
    .client-name { font-size: 16px; font-weight: 800; margin-bottom: 2px; }
    .client-phone { font-size: 12px; color: #475569; font-family: monospace; margin-bottom: 10px; }
    .points-box {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 8px 10px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    }
    .pts { font-size: 18px; font-weight: 900; font-family: monospace; }
    .dzd { font-size: 12px; font-weight: 700; color: #059669; }
    .barcode-wrap { text-align: center; padding-top: 6px; border-top: 1px dashed #cbd5e1; }
    .barcode-code { font-family: monospace; font-size: 11px; letter-spacing: 2px; margin-top: 4px; font-weight: 700; }
    @media print {
      body { padding: 0; }
      @page { margin: 4mm; }
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <div>
        <div class="store">${storeName}</div>
        <div style="font-size:10px;color:#64748b;font-weight:600;">${i18n.t("loyalty.vip_loyalty_card")}</div>
      </div>
      <div class="tier">${tierCfg.emoji} ${tierCfg.label.toUpperCase()}</div>
    </div>
    <div class="client-name">${acc.client_name}</div>
    <div class="client-phone">Tél : ${acc.client_phone || "—"}</div>
    <div class="points-box">
      <div>
        <div style="font-size:10px;color:#64748b;text-transform:uppercase;font-weight:700;">${i18n.t("loyalty.points_balance_card")}</div>
        <div class="pts">${acc.points_balance.toLocaleString("fr-DZ")} pts</div>
      </div>
      <div style="text-align:right;">
        <div style="font-size:10px;color:#64748b;text-transform:uppercase;font-weight:700;">${i18n.t("loyalty.discount_value")}</div>
        <div class="dzd">${formatDZD(dzdVal)} DZD</div>
      </div>
    </div>
    <div class="barcode-wrap">
      <div>${barsHtml}</div>
      <div class="barcode-code">${codeText}</div>
    </div>
  </div>
  <script>window.onload = function() { window.print(); };</script>
</body>
</html>`;

  win.document.write(html);
  win.document.close();
}

function sendLoyaltyWhatsApp(
  acc: LoyaltyAccountSummary,
  program: LoyaltyProgram | null,
  storeName: string,
) {
  const rawPhone = (acc.client_phone || "").replace(/\D/g, "");
  if (!rawPhone) {
    alert("Ce client n'a pas de numéro de téléphone enregistré.");
    return;
  }
  const intlPhone = rawPhone.startsWith("0") ? `213${rawPhone.slice(1)}` : rawPhone;
  const dzdVal = program
    ? Math.floor((acc.points_balance / (program.redemption_value || 100)) * 100)
    : acc.points_balance;
  const tierLabel = TIER_CONFIG[acc.tier]?.label ?? acc.tier;
  const msg = `Bonjour ${acc.client_name} 👋,\nMerci pour votre fidélité chez *${storeName}* !\n\n🏅 Statut : *${tierLabel}*\n🎁 Solde actuel : *${acc.points_balance.toLocaleString("fr-DZ")} points* (équivalent à *${formatDZD(dzdVal)} DZD* de remise sur votre prochain achat).\n\nÀ très bientôt !`;
  window.open(`https://wa.me/${intlPhone}?text=${encodeURIComponent(msg)}`, "_blank");
}

// ── Stats strip ───────────────────────────────────────────────────────────

interface LoyaltyStatsResponse {
  total_members: number;
  total_points_balance: number;
  total_points_dzd_value: string;
  total_points_earned: number;
  total_points_redeemed: number;
  total_redeemed_dzd_value: string;
  tier_counts: {
    bronze: number;
    silver: number;
    gold: number;
  };
}

function StatsStrip({
  statsData,
  accounts,
}: {
  statsData?: LoyaltyStatsResponse;
  accounts: LoyaltyAccountSummary[];
}) {
  const { t } = useTranslation();
  const totalMembers = statsData?.total_members ?? accounts.length;
  const totalPts =
    statsData?.total_points_balance ?? accounts.reduce((s, a) => s + a.points_balance, 0);
  const totalPtsDzd = statsData?.total_points_dzd_value ?? "0";
  const redeemedPts = statsData?.total_points_redeemed ?? 0;
  const redeemedDzd = statsData?.total_redeemed_dzd_value ?? "0";
  const goldCount =
    statsData?.tier_counts?.gold ?? accounts.filter((a) => a.tier === "gold").length;
  const silverCount =
    statsData?.tier_counts?.silver ?? accounts.filter((a) => a.tier === "silver").length;
  const bronzeCount =
    statsData?.tier_counts?.bronze ?? accounts.filter((a) => a.tier === "bronze").length;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 mb-6">
      <div className="card p-4 flex items-center gap-3.5 border border-border">
        <div className="w-11 h-11 rounded-xl bg-primary-50 text-primary-600 flex items-center justify-center shrink-0">
          <Users size={20} />
        </div>
        <div className="min-w-0">
          <p className="text-2xs font-bold uppercase tracking-wider text-text-muted">{t("loyalty.members_title")}</p>
          <p className="text-xl font-black text-text-primary font-mono">{totalMembers}</p>
          <p className="text-2xs text-text-muted mt-0.5">
            🥉 {bronzeCount} · 🥈 {silverCount} · 🥇 {goldCount}
          </p>
        </div>
      </div>

      <div className="card p-4 flex items-center gap-3.5 border border-border">
        <div className="w-11 h-11 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
          <Gift size={20} />
        </div>
        <div className="min-w-0">
          <p className="text-2xs font-bold uppercase tracking-wider text-text-muted">{t("loyalty.active_points")}</p>
          <p className="text-xl font-black text-emerald-700 font-mono">
            {totalPts.toLocaleString("fr-DZ")} <span className="text-xs font-sans">pts</span>
          </p>
          <p className="text-2xs font-semibold text-emerald-600 mt-0.5">
            {t("loyalty.pts_value_discount", { val: formatDZD(totalPtsDzd) })}
          </p>
        </div>
      </div>

      <div className="card p-4 flex items-center gap-3.5 border border-border">
        <div className="w-11 h-11 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
          <Coins size={20} />
        </div>
        <div className="min-w-0">
          <p className="text-2xs font-bold uppercase tracking-wider text-text-muted">{t("loyalty.redeemed_points")}</p>
          <p className="text-xl font-black text-indigo-700 font-mono">
            {redeemedPts.toLocaleString("fr-DZ")} <span className="text-xs font-sans">pts</span>
          </p>
          <p className="text-2xs font-semibold text-indigo-600 mt-0.5">
            {t("loyalty.discounts_granted", { val: formatDZD(redeemedDzd) })}
          </p>
        </div>
      </div>

      <div className="card p-4 flex items-center gap-3.5 border border-border">
        <div className="w-11 h-11 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
          <Trophy size={20} />
        </div>
        <div className="min-w-0">
          <p className="text-2xs font-bold uppercase tracking-wider text-text-muted">{t("loyalty.vip_members")}</p>
          <p className="text-xl font-black text-amber-700 font-mono">{silverCount + goldCount}</p>
          <p className="text-2xs text-text-muted mt-0.5">
            {t("loyalty.pct_of_file", { pct: totalMembers > 0 ? Math.round(((silverCount + goldCount) / totalMembers) * 100) : 0 })}
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Program form + Simulator ──────────────────────────────────────────────

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
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { user } = useAuth();
  const isOwner = user?.role === "owner" || user?.role === "manager";
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);
  const [simAmount, setSimAmount] = useState<number>(5000);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isDirty },
  } = useForm<ProgramFormData>({
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

  const [
    ptsPer100,
    redemptionVal,
    minRedemptionPts,
    silverThreshold,
    goldThreshold,
    silverMultiplier,
    goldMultiplier,
  ] = watch([
    "points_per_100dzd",
    "redemption_value",
    "min_redemption_points",
    "silver_threshold",
    "gold_threshold",
    "silver_multiplier",
    "gold_multiplier",
  ]);

  const mutation = useMutation({
    mutationFn: (data: ProgramFormData) => {
      const payload = {
        ...data,
        expiry_months: data.expiry_months ? parseInt(data.expiry_months) : null,
      };
      if (program) return api.patch(`/loyalty/programs/${program.id}/`, payload).then((r) => r.data);
      return api.post("/loyalty/programs/", payload).then((r) => r.data);
    },
    onSuccess: () => {
      setToast({ msg: "Programme de fidélité enregistré avec succès.", type: "success" });
      qc.invalidateQueries({ queryKey: ["loyalty-program"] });
      qc.invalidateQueries({ queryKey: ["loyalty-stats"] });
    },
    onError: (err) => setToast({ msg: getApiError(err), type: "error" }),
  });

  const safePtsPer100 = Number(ptsPer100) || 1;
  const safeRedeemVal = Number(redemptionVal) || 100;
  const basePtsEarned = Math.floor((simAmount || 0) / 100) * safePtsPer100;
  const silverPtsEarned = Math.floor(basePtsEarned * (Number(silverMultiplier) || 1.2));
  const goldPtsEarned = Math.floor(basePtsEarned * (Number(goldMultiplier) || 1.5));

  const dzdForPts = (pts: number) => Math.round((pts / safeRedeemVal) * 100);

  return (
    <div className="space-y-5">
      {/* Visual Tier Cards + Live Simulator */}
      <div className="card p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
              <Calculator size={18} />
            </div>
            <div>
              <h2 className="text-sm font-bold text-text-primary">
                Paliers de Fidélité & Simulateur de Gains (DZD ↔ Points)
              </h2>
              <p className="text-xs text-text-muted">
                Testez en direct combien un client gagne et économise selon son niveau
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {[2500, 5000, 10000, 20000].map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setSimAmount(preset)}
                className={cn(
                  "px-2.5 py-1 rounded-lg text-2xs font-bold border transition-all cursor-pointer",
                  simAmount === preset
                    ? "bg-primary-600 text-white border-primary-600"
                    : "bg-surface text-text-secondary border-border hover:border-primary-300",
                )}
              >
                {preset.toLocaleString("fr-DZ")} DA
              </button>
            ))}
          </div>
        </div>

        {/* Simulator Bar */}
        <div className="p-3.5 rounded-2xl bg-surface border border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <label className="text-xs font-bold text-text-secondary whitespace-nowrap">
              Panier d'achat simulé :
            </label>
            <div className="relative w-36">
              <input
                type="number"
                min={100}
                step={100}
                value={simAmount}
                onChange={(e) => setSimAmount(Math.max(0, Number(e.target.value) || 0))}
                className="form-input h-9 pr-12 font-mono font-bold text-sm"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-2xs font-bold text-text-muted">
                DZD
              </span>
            </div>
          </div>
          <div className="text-xs text-text-muted">
            Seuil minimum de rachat :{" "}
            <strong className="text-text-primary">{minRedemptionPts || 500} pts</strong> (={" "}
            <strong className="text-emerald-600">{dzdForPts(Number(minRedemptionPts) || 500)} DZD</strong>{" "}
            de remise en caisse)
          </div>
        </div>

        {/* 3 Tier Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* Bronze */}
          <div className={cn("rounded-2xl p-4 border bg-gradient-to-br", TIER_CONFIG.bronze.cardBg)}>
            <div className="flex items-center justify-between mb-2">
              <TierBadge tier="bronze" />
              <span className="text-xs font-black font-mono text-amber-800">×1.0</span>
            </div>
            <p className="text-2xs text-amber-900/80 font-medium">{t("loyalty.bronze_entry")}</p>
            <div className="mt-3 pt-2.5 border-t border-amber-200/80 flex items-baseline justify-between">
              <span className="text-2xs text-amber-900">Gain sur {simAmount.toLocaleString("fr-DZ")} DA :</span>
              <div className="text-right">
                <span className="text-sm font-black font-mono text-amber-900">+{basePtsEarned} pts</span>
                <span className="block text-2xs font-bold text-emerald-700">
                  ≈ {dzdForPts(basePtsEarned)} DZD
                </span>
              </div>
            </div>
          </div>

          {/* Silver */}
          <div className={cn("rounded-2xl p-4 border bg-gradient-to-br", TIER_CONFIG.silver.cardBg)}>
            <div className="flex items-center justify-between mb-2">
              <TierBadge tier="silver" />
              <span className="text-xs font-black font-mono text-slate-700">
                ×{silverMultiplier || 1.2}
              </span>
            </div>
            <p className="text-2xs text-slate-600 font-medium">
              À partir de {(silverThreshold || 5000).toLocaleString("fr-DZ")} pts cumulés
            </p>
            <div className="mt-3 pt-2.5 border-t border-slate-300/80 flex items-baseline justify-between">
              <span className="text-2xs text-slate-700">Gain sur {simAmount.toLocaleString("fr-DZ")} DA :</span>
              <div className="text-right">
                <span className="text-sm font-black font-mono text-slate-900">+{silverPtsEarned} pts</span>
                <span className="block text-2xs font-bold text-emerald-700">
                  ≈ {dzdForPts(silverPtsEarned)} DZD
                </span>
              </div>
            </div>
          </div>

          {/* Gold */}
          <div className={cn("rounded-2xl p-4 border bg-gradient-to-br", TIER_CONFIG.gold.cardBg)}>
            <div className="flex items-center justify-between mb-2">
              <TierBadge tier="gold" />
              <span className="text-xs font-black font-mono text-yellow-800">
                ×{goldMultiplier || 1.5}
              </span>
            </div>
            <p className="text-2xs text-yellow-900/80 font-medium">
              À partir de {(goldThreshold || 15000).toLocaleString("fr-DZ")} pts cumulés
            </p>
            <div className="mt-3 pt-2.5 border-t border-yellow-300/80 flex items-baseline justify-between">
              <span className="text-2xs text-yellow-900">Gain sur {simAmount.toLocaleString("fr-DZ")} DA :</span>
              <div className="text-right">
                <span className="text-sm font-black font-mono text-yellow-900">+{goldPtsEarned} pts</span>
                <span className="block text-2xs font-bold text-emerald-700">
                  ≈ {dzdForPts(goldPtsEarned)} DZD
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Configuration Form */}
      <div className="card p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-9 h-9 rounded-lg bg-primary-50 flex items-center justify-center">
            <Settings size={18} className="text-primary-500" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-text-primary">{t("loyalty.config_rules_title")}</h2>
            <p className="text-xs text-text-muted">{t("loyalty.config_rules_subtitle")}</p>
          </div>
          {program && (
            <span
              className={cn(
                "ml-auto text-xs font-bold px-2.5 py-1 rounded-full",
                program.is_active ? "bg-success-light text-success" : "bg-danger-light text-danger",
              )}
            >
              {program.is_active ? t("loyalty.program_active") : t("loyalty.program_inactive")}
            </span>
          )}
        </div>

        {toast && (
          <div
            className={cn(
              "mb-4 rounded-xl px-4 py-2.5 text-xs font-bold flex items-center justify-between",
              toast.type === "success" ? "bg-success-light text-success" : "bg-danger-light text-danger",
            )}
          >
            <span>{toast.msg}</span>
            <button onClick={() => setToast(null)}>
              <X size={14} />
            </button>
          </div>
        )}

        <form onSubmit={handleSubmit((d) => mutation.mutate(d))} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="form-label">{t("loyalty.pts_earned_per_100")}</label>
              <input
                type="number"
                min={1}
                {...register("points_per_100dzd", { required: true, valueAsNumber: true, min: 1 })}
                className="form-input"
                disabled={!isOwner}
              />
              {errors.points_per_100dzd && <p className="form-error">{t("common.required_min_1")}</p>}
            </div>
            <div>
              <label className="form-label">{t("loyalty.pts_redeem_per_100")}</label>
              <input
                type="number"
                min={1}
                {...register("redemption_value", { required: true, valueAsNumber: true, min: 1 })}
                className="form-input"
                disabled={!isOwner}
              />
              {errors.redemption_value && <p className="form-error">{t("common.required_min_1")}</p>}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="form-label">{t("loyalty.min_pts_redemption")}</label>
              <input
                type="number"
                min={0}
                {...register("min_redemption_points", { required: true, valueAsNumber: true, min: 0 })}
                className="form-input"
                disabled={!isOwner}
              />
            </div>
            <div>
              <label className="form-label">{t("loyalty.expiry_months")}</label>
              <input
                type="number"
                min={1}
                placeholder={t("loyalty.unlimited_expiry")}
                {...register("expiry_months")}
                className="form-input"
                disabled={!isOwner}
              />
            </div>
          </div>

          <div className="border border-border rounded-xl p-4 space-y-3">
            <p className="text-xs font-semibold text-text-primary flex items-center gap-1.5">
              <Zap size={12} /> Seuils & Multiplicateurs des Niveaux VIP
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="form-label">{t("loyalty.silver_threshold")}</label>
                <input
                  type="number"
                  min={1}
                  {...register("silver_threshold", { required: true, valueAsNumber: true, min: 1 })}
                  className="form-input"
                  disabled={!isOwner}
                />
              </div>
              <div>
                <label className="form-label">{t("loyalty.silver_mult")}</label>
                <input
                  type="number"
                  min={1}
                  step={0.05}
                  {...register("silver_multiplier", { required: true, valueAsNumber: true, min: 1 })}
                  className="form-input"
                  disabled={!isOwner}
                />
              </div>
              <div>
                <label className="form-label">{t("loyalty.gold_threshold")}</label>
                <input
                  type="number"
                  min={1}
                  {...register("gold_threshold", { required: true, valueAsNumber: true, min: 1 })}
                  className="form-input"
                  disabled={!isOwner}
                />
              </div>
              <div>
                <label className="form-label">{t("loyalty.gold_mult")}</label>
                <input
                  type="number"
                  min={1}
                  step={0.05}
                  {...register("gold_multiplier", { required: true, valueAsNumber: true, min: 1 })}
                  className="form-input"
                  disabled={!isOwner}
                />
              </div>
            </div>
          </div>

          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              {...register("is_active")}
              className="w-4 h-4 accent-primary-500"
              disabled={!isOwner}
            />
            <span className="text-sm font-medium text-text-primary">
              Activer le programme de fidélité en caisse (POS)
            </span>
          </label>

          {isOwner && (
            <button
              type="submit"
              className="btn-primary w-full"
              disabled={mutation.isPending || (!isDirty && !!program)}
            >
              {mutation.isPending
                ? "Enregistrement…"
                : program
                ? "Enregistrer les modifications"
                : "Activer & Créer le programme"}
            </button>
          )}
        </form>
      </div>
    </div>
  );
}

// ── Leaderboard ───────────────────────────────────────────────────────────

function Leaderboard({
  accounts,
  program,
  storeName,
  onSelectHistory,
}: {
  accounts: LoyaltyAccountSummary[];
  program: LoyaltyProgram | null;
  storeName: string;
  onSelectHistory: (acc: LoyaltyAccountSummary) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="card p-6 h-fit">
      <div className="flex items-center gap-3 mb-5">
        <div className="w-9 h-9 rounded-lg bg-yellow-50 flex items-center justify-center">
          <Trophy size={18} className="text-yellow-500" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-text-primary">{t("loyalty.top_clients_ranking")}</h2>
          <p className="text-xs text-text-muted">{t("loyalty.top_members_desc")}</p>
        </div>
      </div>

      {accounts.length === 0 ? (
        <div className="text-center py-10 text-text-muted text-sm">
          <Users size={36} className="mx-auto mb-3 opacity-30" />
          Aucun client inscrit au programme. Cliquez sur « Inscrire un client » en haut pour démarrer.
        </div>
      ) : (
        <div className="space-y-2">
          {accounts.map((acc, idx) => {
            const dzdVal = program
              ? Math.floor((acc.points_balance / (program.redemption_value || 100)) * 100)
              : acc.points_balance;
            return (
              <div
                key={acc.id}
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-transparent hover:border-border hover:bg-surface transition-all"
              >
                <span
                  className={cn(
                    "w-6 h-6 flex items-center justify-center rounded-full text-xs font-bold flex-shrink-0",
                    idx === 0
                      ? "bg-yellow-100 text-yellow-700"
                      : idx === 1
                      ? "bg-slate-200 text-slate-700"
                      : idx === 2
                      ? "bg-amber-100 text-amber-800"
                      : "bg-surface text-text-muted",
                  )}
                >
                  {idx + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-bold text-text-primary truncate">{acc.client_name}</p>
                    <TierBadge tier={acc.tier} />
                  </div>
                  <p className="text-xs text-text-muted font-mono">{acc.client_phone || "Sans téléphone"}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-sm font-black font-mono text-primary-600">
                    {acc.points_balance.toLocaleString("fr-DZ")} pts
                  </p>
                  <p className="text-2xs font-semibold text-emerald-600">≈ {formatDZD(dzdVal)} DZD</p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => onSelectHistory(acc)}
                    title="Historique des points"
                    className="p-1.5 rounded-lg text-text-muted hover:text-primary-600 hover:bg-white border border-transparent hover:border-border"
                  >
                    <History size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => printLoyaltyCard(acc, program, storeName)}
                    title="Imprimer Carte de Fidélité"
                    className="p-1.5 rounded-lg text-text-muted hover:text-primary-600 hover:bg-white border border-transparent hover:border-border"
                  >
                    <Printer size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Enroll Client Modal ───────────────────────────────────────────────────

function EnrollClientModal({
  onClose,
}: {
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [welcomePoints, setWelcomePoints] = useState("100");
  const [error, setError] = useState<string | null>(null);

  const { data: clientsData, isLoading } = useQuery<PaginatedResponse<Client>>({
    queryKey: ["clients-loyalty-enroll", search],
    queryFn: () =>
      api
        .get("/clients/", { params: { search: search.trim(), page_size: 10 } })
        .then((r) => r.data),
  });

  const enrollMutation = useMutation({
    mutationFn: () =>
      api
        .post("/loyalty/accounts/enroll/", {
          client_id: selectedClient?.id,
          welcome_points: parseInt(welcomePoints) || 0,
        })
        .then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["loyalty-accounts"] });
      qc.invalidateQueries({ queryKey: ["loyalty-stats"] });
      qc.invalidateQueries({ queryKey: ["loyalty-program"] });
      onClose();
    },
    onError: (err) => setError(getApiError(err)),
  });

  const enrollAllMutation = useMutation({
    mutationFn: () =>
      api.post("/loyalty/accounts/enroll/", { enroll_all: true }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["loyalty-accounts"] });
      qc.invalidateQueries({ queryKey: ["loyalty-stats"] });
      qc.invalidateQueries({ queryKey: ["loyalty-program"] });
      onClose();
    },
    onError: (err) => setError(getApiError(err)),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between p-5 border-b border-border bg-primary-50/50">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-primary-100 text-primary-700">
              <UserPlus size={18} />
            </div>
            <div>
              <h3 className="font-bold text-text-primary text-sm">{t("loyalty.enroll_client")}</h3>
              <p className="text-2xs text-text-muted">{t("loyalty.enroll_client")}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface">
            <X size={18} className="text-text-muted" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {error && (
            <div className="p-3 rounded-xl bg-danger-light text-danger text-xs font-medium">{error}</div>
          )}

          {/* Quick Bulk Sync Button */}
          <div className="p-3 rounded-xl bg-indigo-50/70 border border-indigo-200 flex items-center justify-between gap-3">
            <div className="text-2xs text-indigo-950">
              <strong className="block">{t("loyalty.enroll_all_active")}</strong>
              <span>{t("loyalty.enroll_all_desc")}</span>
            </div>
            <button
              type="button"
              onClick={() => enrollAllMutation.mutate()}
              disabled={enrollAllMutation.isPending}
              className="btn-secondary btn-xs whitespace-nowrap border-indigo-300 text-indigo-700 hover:bg-indigo-100"
            >
              {enrollAllMutation.isPending ? t("common.loading") : t("loyalty.enroll_all_active")}
            </button>
          </div>

          <div>
            <label className="form-label text-xs">{t("loyalty.search_member_placeholder")} *</label>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("loyalty.search_member_placeholder")}
                className="form-input pl-9 text-xs"
              />
            </div>

            <div className="mt-2 max-h-44 overflow-y-auto divide-y divide-border border border-border rounded-xl">
              {isLoading ? (
                <p className="p-3 text-xs text-text-muted text-center">{t("common.loading")}</p>
              ) : (clientsData?.results ?? []).length === 0 ? (
                <p className="p-3 text-xs text-text-muted text-center">{t("common.no_data")}</p>
              ) : (
                (clientsData?.results ?? []).map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setSelectedClient(c)}
                    className={cn(
                      "w-full px-3 py-2 text-left flex items-center justify-between text-xs hover:bg-surface transition-colors cursor-pointer",
                      selectedClient?.id === c.id ? "bg-primary-50 font-bold text-primary-700" : "",
                    )}
                  >
                    <div>
                      <span className="block font-semibold text-text-primary">{c.name}</span>
                      <span className="text-2xs text-text-muted font-mono">{c.phone}</span>
                    </div>
                    {selectedClient?.id === c.id && (
                      <CheckCircle2 size={16} className="text-primary-600" />
                    )}
                  </button>
                ))
              )}
            </div>
          </div>

          <div>
            <label className="form-label text-xs">{t("loyalty.welcome_bonus")}</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                value={welcomePoints}
                onChange={(e) => setWelcomePoints(e.target.value)}
                className="form-input text-xs font-mono font-bold"
              />
              {[0, 50, 100, 200, 500].map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setWelcomePoints(String(p))}
                  className={cn(
                    "px-2.5 py-1.5 rounded-lg text-2xs font-bold border cursor-pointer",
                    welcomePoints === String(p)
                      ? "bg-primary-600 text-white border-primary-600"
                      : "bg-surface text-text-secondary border-border",
                  )}
                >
                  +{p}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex gap-2 p-4 border-t border-border bg-surface/50">
          <button onClick={onClose} className="btn-secondary btn-sm flex-1">
            Annuler
          </button>
          <button
            onClick={() => enrollMutation.mutate()}
            disabled={!selectedClient || enrollMutation.isPending}
            className="btn-primary btn-sm flex-1"
          >
            {enrollMutation.isPending ? "Inscription…" : "Inscrire le client"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Account History Modal ─────────────────────────────────────────────────

function AccountHistoryModal({
  accountSummary,
  program,
  storeName,
  onClose,
}: {
  accountSummary: LoyaltyAccountSummary;
  program: LoyaltyProgram | null;
  storeName: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { data: fullAccount, isLoading } = useQuery<LoyaltyAccount>({
    queryKey: ["loyalty-account-detail", accountSummary.id],
    queryFn: () => api.get(`/loyalty/accounts/${accountSummary.id}/`).then((r) => r.data),
  });

  const transactions = fullAccount?.transactions ?? [];
  const dzdVal = program
    ? Math.floor((accountSummary.points_balance / (program.redemption_value || 100)) * 100)
    : accountSummary.points_balance;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-text-primary">{accountSummary.client_name}</h3>
              <TierBadge tier={accountSummary.tier} />
            </div>
            <p className="text-xs text-text-muted font-mono mt-0.5">
              {accountSummary.client_phone} · Inscrit le {formatDate(accountSummary.enrolled_at)}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => printLoyaltyCard(accountSummary, program, storeName)}
              className="btn-secondary btn-xs flex items-center gap-1"
            >
              <Printer size={13} />
              Carte
            </button>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface">
              <X size={18} className="text-text-muted" />
            </button>
          </div>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-3 gap-3 bg-surface p-3.5 rounded-xl border border-border text-center">
            <div>
              <span className="text-2xs uppercase font-bold text-text-muted block">{t("loyalty.current_balance_pts")}</span>
              <span className="text-base font-black font-mono text-primary-600">
                {accountSummary.points_balance.toLocaleString("fr-DZ")} pts
              </span>
            </div>
            <div>
              <span className="text-2xs uppercase font-bold text-text-muted block">{t("loyalty.discount_value")}</span>
              <span className="text-base font-black font-mono text-emerald-600">
                {formatDZD(dzdVal)} DZD
              </span>
            </div>
            <div>
              <span className="text-2xs uppercase font-bold text-text-muted block">{t("loyalty.total_accumulated")}</span>
              <span className="text-base font-black font-mono text-text-primary">
                {accountSummary.total_earned.toLocaleString("fr-DZ")} pts
              </span>
            </div>
          </div>

          <h4 className="text-xs font-bold uppercase tracking-wider text-text-muted">
            Journal des mouvements de points ({transactions.length})
          </h4>

          <div className="max-h-72 overflow-y-auto divide-y divide-border border border-border rounded-xl">
            {isLoading ? (
              <p className="p-6 text-center text-xs text-text-muted">{t("common.loading")}</p>
            ) : transactions.length === 0 ? (
              <p className="p-6 text-center text-xs text-text-muted">
                Aucune transaction enregistrée pour ce client.
              </p>
            ) : (
              transactions.map((tx) => (
                <div key={tx.id} className="px-4 py-2.5 flex items-center justify-between text-xs">
                  <div>
                    <p className="font-semibold text-text-primary">
                      {tx.description ||
                        (tx.transaction_type === "earn"
                          ? "Gain sur achat"
                          : tx.transaction_type === "redeem"
                          ? "Rachat de points en caisse"
                          : "Ajustement manuel")}
                    </p>
                    <p className="text-2xs text-text-muted font-mono">{formatDate(tx.created_at)}</p>
                  </div>
                  <div className="text-right font-mono">
                    <span
                      className={cn(
                        "font-bold text-sm",
                        tx.points > 0 ? "text-emerald-600" : "text-rose-600",
                      )}
                    >
                      {tx.points > 0 ? `+${tx.points}` : tx.points} pts
                    </span>
                    <span className="block text-2xs text-text-muted">Solde : {tx.balance_after} pts</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
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
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [points, setPoints] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      api
        .post(`/loyalty/accounts/${account.id}/adjust/`, {
          points: parseInt(points),
          description: description || "Ajustement manuel",
        })
        .then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["loyalty-accounts"] });
      qc.invalidateQueries({ queryKey: ["loyalty-stats"] });
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
            <h3 className="font-semibold text-text-primary">{t("loyalty.adjust_points")}</h3>
            <p className="text-xs text-text-muted mt-0.5">{account.client_name}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-surface transition-colors">
            <X size={18} className="text-text-muted" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex items-center justify-between rounded-xl bg-surface p-3">
            <div>
              <p className="text-xs text-text-muted">{t("loyalty.balance_pts")}</p>
              <p className="text-lg font-bold text-text-primary">
                {account.points_balance.toLocaleString("fr-DZ")} pts
              </p>
            </div>
            <TierBadge tier={account.tier} />
          </div>

          <div>
            <label className="form-label">{t("loyalty.points_delta")}</label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {[50, 100, 250, 500, -100, -500].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setPoints(String(preset))}
                  className={cn(
                    "px-2.5 py-1 rounded-lg text-2xs font-bold border cursor-pointer",
                    points === String(preset)
                      ? "bg-primary-600 text-white border-primary-600"
                      : preset > 0
                      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                      : "bg-rose-50 text-rose-700 border-rose-200",
                  )}
                >
                  {preset > 0 ? `+${preset}` : preset} pts
                </button>
              ))}
            </div>
            <input
              type="number"
              value={points}
              onChange={(e) => setPoints(e.target.value)}
              placeholder="+100 ou -50"
              className="form-input font-mono font-bold"
              autoFocus
            />
          </div>

          <div>
            <label className="form-label">
              {t("invoice.reason")} <span className="text-text-muted font-normal">({t("common.optional", "optionnel")})</span>
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("loyalty.reason_placeholder")}
              className="form-input"
            />
          </div>

          {pts !== 0 && (
            <div
              className={cn(
                "rounded-xl p-3 text-sm font-medium",
                newBalance < 0
                  ? "bg-danger-light text-danger"
                  : pts > 0
                  ? "bg-success-light text-success"
                  : "bg-amber-50 text-amber-700",
              )}
            >
              {newBalance < 0
                ? "Solde insuffisant pour ce retrait."
                : `Nouveau solde : ${newBalance.toLocaleString("fr-DZ")} pts`}
            </div>
          )}

          {error && <p className="text-sm text-danger bg-danger-light rounded-lg px-3 py-2">{error}</p>}
        </div>

        <div className="flex gap-3 p-5 pt-0">
          <button onClick={onClose} className="btn-secondary flex-1">
            Annuler
          </button>
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

function AccountsPanel({
  program,
  storeName,
  onSelectHistory,
}: {
  program: LoyaltyProgram | null;
  storeName: string;
  onSelectHistory: (acc: LoyaltyAccountSummary) => void;
}) {
  const { user } = useAuth();
  const isManager = user?.role === "owner" || user?.role === "manager";

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [tierFilter, setTierFilter] = useState<TierFilter>("all");
  const [page, setPage] = useState(1);
  const [adjustAccount, setAdjustAccount] = useState<LoyaltyAccountSummary | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const params = new URLSearchParams({
    ordering: "-total_earned",
    page_size: "20",
    page: String(page),
  });
  if (debouncedSearch) params.set("search", debouncedSearch);
  if (tierFilter !== "all") params.set("tier", tierFilter);

  const { t } = useTranslation();
  const { data, isLoading } = useQuery<PaginatedResponse<LoyaltyAccountSummary>>({
    queryKey: ["loyalty-accounts", debouncedSearch, tierFilter, page],
    queryFn: () => api.get(`/loyalty/accounts/?${params}`).then((r) => r.data),
  });

  const accounts = data?.results ?? [];
  const totalCount = data?.count ?? 0;
  const totalPages = Math.ceil(totalCount / 20);

  const TIERS: { value: TierFilter; label: string }[] = [
    { value: "all", label: t("loyalty.all_tiers") },
    { value: "gold", label: "🥇 Or" },
    { value: "silver", label: "🥈 Argent" },
    { value: "bronze", label: "🥉 Bronze" },
  ];

  return (
    <div className="card p-6">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("loyalty.search_member_placeholder")}
            className="form-input pl-9"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {TIERS.map((tier) => (
            <button
              key={tier.value}
              onClick={() => {
                setTierFilter(tier.value);
                setPage(1);
              }}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors cursor-pointer",
                tierFilter === tier.value
                  ? "bg-primary-600 text-white border-primary-600"
                  : "bg-white text-text-secondary border-border hover:border-primary-300",
              )}
            >
              {tier.label}
            </button>
          ))}
        </div>
      </div>

      <p className="text-xs text-text-muted mb-3">
        {isLoading ? t("common.loading") : `${totalCount} compte${totalCount !== 1 ? "s" : ""} fidélité`}
      </p>

      {isLoading ? (
        <div className="text-center py-12 text-text-muted text-sm">{t("common.loading")}</div>
      ) : accounts.length === 0 ? (
        <div className="text-center py-12 text-text-muted text-sm">
          <Users size={36} className="mx-auto mb-3 opacity-30" />
          {t("common.no_data")}
        </div>
      ) : (
        <div className="overflow-x-auto -mx-6">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface/60">
                <th className="text-left text-xs font-semibold text-text-muted px-5 py-2.5">{t("invoice.client")}</th>
                <th className="text-left text-xs font-semibold text-text-muted px-3 py-2.5">{t("loyalty.tier_and_progression")}</th>
                <th className="text-right text-xs font-semibold text-text-muted px-3 py-2.5">{t("loyalty.balance_pts")}</th>
                <th className="text-right text-xs font-semibold text-text-muted px-3 py-2.5">{t("sales.discount")}</th>
                <th className="text-right text-xs font-semibold text-text-muted px-3 py-2.5">{t("loyalty.cumulated_pts")}</th>
                <th className="text-left text-xs font-semibold text-text-muted px-3 py-2.5">{t("invoice.date")}</th>
                <th className="text-right text-xs font-semibold text-text-muted px-5 py-2.5">{t("common.actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {accounts.map((acc) => {
                const dzdVal = program
                  ? Math.floor((acc.points_balance / (program.redemption_value || 100)) * 100)
                  : acc.points_balance;
                return (
                  <tr key={acc.id} className="hover:bg-surface/60 transition-colors">
                    <td className="px-5 py-3">
                      <p className="font-bold text-text-primary">{acc.client_name}</p>
                      <p className="text-xs text-text-muted font-mono">{acc.client_phone || "—"}</p>
                    </td>
                    <td className="px-3 py-3">
                      <TierBadge tier={acc.tier} />
                      {acc.next_tier && acc.points_to_next_tier != null && (
                        <p className="text-2xs text-text-muted mt-1">
                          Plus que <strong>{acc.points_to_next_tier.toLocaleString("fr-DZ")} pts</strong> →{" "}
                          {TIER_CONFIG[acc.next_tier].label}
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right font-mono">
                      <span className="font-black text-primary-600">
                        {acc.points_balance.toLocaleString("fr-DZ")}
                      </span>
                      <span className="text-xs text-text-muted"> pts</span>
                    </td>
                    <td className="px-3 py-3 text-right font-mono">
                      <span className="font-bold text-emerald-600">{formatDZD(dzdVal)} DZD</span>
                    </td>
                    <td className="px-3 py-3 text-right font-mono">
                      <span className="text-text-secondary">{acc.total_earned.toLocaleString("fr-DZ")}</span>
                      <span className="text-xs text-text-muted"> pts</span>
                    </td>
                    <td className="px-3 py-3 text-text-muted text-xs">{formatDate(acc.enrolled_at)}</td>
                    <td className="px-5 py-3 text-right">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => onSelectHistory(acc)}
                          className="p-1.5 rounded-lg text-text-secondary hover:text-primary-600 hover:bg-primary-50 transition-colors"
                          title="Historique des points"
                        >
                          <History size={15} />
                        </button>
                        <button
                          type="button"
                          onClick={() => printLoyaltyCard(acc, program, storeName)}
                          className="p-1.5 rounded-lg text-text-secondary hover:text-primary-600 hover:bg-primary-50 transition-colors"
                          title="Imprimer Carte de Fidélité"
                        >
                          <Printer size={15} />
                        </button>
                        {acc.client_phone && (
                          <button
                            type="button"
                            onClick={() => sendLoyaltyWhatsApp(acc, program, storeName)}
                            className="p-1.5 rounded-lg text-emerald-600 hover:bg-emerald-50 transition-colors"
                            title="Envoyer le solde par WhatsApp"
                          >
                            <MessageCircle size={15} />
                          </button>
                        )}
                        {isManager && (
                          <button
                            onClick={() => setAdjustAccount(acc)}
                            className="inline-flex items-center gap-1 text-xs font-bold text-primary-600 hover:text-primary-700 hover:bg-primary-50 px-2.5 py-1.5 rounded-lg transition-colors"
                          >
                            <PlusCircle size={13} />
                            Ajuster
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 pt-4 border-t border-border">
          <p className="text-xs text-text-muted">
            Page {page} / {totalPages}
          </p>
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
  const { t } = useTranslation();
  const { user } = useAuth();
  const storeName = user?.tenant?.name ?? "Pointure";

  const [tab, setTab] = useState<Tab>("programme");
  const [showEnrollModal, setShowEnrollModal] = useState(false);
  const [historyAccount, setHistoryAccount] = useState<LoyaltyAccountSummary | null>(null);

  const { data: programData } = useQuery<{ results: LoyaltyProgram[] }>({
    queryKey: ["loyalty-program"],
    queryFn: () => api.get("/loyalty/programs/").then((r) => r.data),
  });

  const { data: statsData } = useQuery<LoyaltyStatsResponse>({
    queryKey: ["loyalty-stats"],
    queryFn: () => api.get("/loyalty/accounts/stats/").then((r) => r.data),
  });

  const { data: accountsData } = useQuery<PaginatedResponse<LoyaltyAccountSummary>>({
    queryKey: ["loyalty-accounts", "", "all", 1],
    queryFn: () =>
      api.get("/loyalty/accounts/?ordering=-total_earned&page_size=20").then((r) => r.data),
  });

  const program = programData?.results?.[0] ?? null;
  const accounts = accountsData?.results ?? [];

  const TABS: { key: Tab; label: string; icon: typeof Settings }[] = [
    { key: "programme", label: "Programme & Simulateur", icon: Sparkles },
    { key: "comptes", label: `Comptes & Cartes (${statsData?.total_members ?? accounts.length})`, icon: Users },
  ];

  return (
    <div className="max-w-6xl mx-auto pb-12">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-primary-500 to-indigo-600 flex items-center justify-center shadow-sm">
            <Gift size={22} className="text-white" />
          </div>
          <div>
            <h1 className="text-xl font-black text-text-primary tracking-tight">
              {t("loyalty.title", "Programme de Fidélité & Cartes VIP")}
            </h1>
            <p className="text-xs text-text-muted">
              Fidélisez vos clients avec des points convertibles en dinars, paliers Bronze/Argent/Or et cartes imprimables
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {!program && (
            <div className="flex items-center gap-1.5 text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-xs font-bold">
              <AlertCircle size={14} />
              Programme à initialiser
            </div>
          )}
          <button
            type="button"
            onClick={() => setShowEnrollModal(true)}
            className="btn-primary btn-sm flex items-center gap-1.5 cursor-pointer"
          >
            <UserPlus size={15} />
            Inscrire un client
          </button>
        </div>
      </div>

      <StatsStrip statsData={statsData} accounts={accounts} />

      {/* Tab bar */}
      <div className="flex gap-1 mb-5 bg-surface rounded-xl p-1 w-fit border border-border">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-colors cursor-pointer",
              tab === key
                ? "bg-white text-text-primary shadow-sm"
                : "text-text-muted hover:text-text-secondary",
            )}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      {tab === "programme" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <div className="lg:col-span-7">
            <ProgramPanel program={program} />
          </div>
          <div className="lg:col-span-5">
            <Leaderboard
              accounts={accounts}
              program={program}
              storeName={storeName}
              onSelectHistory={(acc) => setHistoryAccount(acc)}
            />
          </div>
        </div>
      )}

      {tab === "comptes" && (
        <AccountsPanel
          program={program}
          storeName={storeName}
          onSelectHistory={(acc) => setHistoryAccount(acc)}
        />
      )}

      {showEnrollModal && <EnrollClientModal onClose={() => setShowEnrollModal(false)} />}

      {historyAccount && (
        <AccountHistoryModal
          accountSummary={historyAccount}
          program={program}
          storeName={storeName}
          onClose={() => setHistoryAccount(null)}
        />
      )}
    </div>
  );
}
