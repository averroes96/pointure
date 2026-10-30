import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Plus, Trash2, MessageCircle, Instagram, Copy, Check, Sparkles, Truck, CheckCircle2 } from "lucide-react";
import api, { getApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

export default function DeliverySettingsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [toast, setToast] = useState<string | null>(null);
  const [copiedWebhook, setCopiedWebhook] = useState(false);

  // ─── Provider Configs ───────────────────────────────────────────
  const { data: configs = [], isLoading } = useQuery({
    queryKey: ["provider-configs"],
    queryFn: async () => {
      const res = await api.get("/deliveries/provider-configs/");
      return res.data.results || res.data;
    },
  });

  const saveMutation = useMutation({
    mutationFn: (data: any) => {
      if (data.id) return api.put(`/deliveries/provider-configs/${data.id}/`, data);
      return api.post("/deliveries/provider-configs/", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["provider-configs"] });
      setToast(t("deliveries.settings_saved", "Paramètres enregistrés avec succès."));
      setTimeout(() => setToast(null), 3000);
    },
    onError: (err) => setToast(getApiError(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/deliveries/provider-configs/${id}/`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["provider-configs"] }),
  });

  const [newConfig, setNewConfig] = useState({
    provider: "yalidine",
    api_id: "",
    api_secret: "",
    is_active: true,
  });

  const handleAdd = () => {
    saveMutation.mutate(newConfig);
    setNewConfig({ provider: "yalidine", api_id: "", api_secret: "", is_active: true });
  };

  // ─── Social Integrations ───────────────────────────────────────
  const { data: socialConfigs = [] } = useQuery({
    queryKey: ["social-integrations"],
    queryFn: async () => {
      const res = await api.get("/deliveries/social-integrations/");
      return res.data.results || res.data;
    },
  });

  const socialDeleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/deliveries/social-integrations/${id}/`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["social-integrations"] }),
  });

  // Build the webhook URL dynamically
  const webhookUrl = `${window.location.origin}/api/v1/deliveries/meta-webhook/`;

  const copyWebhookUrl = () => {
    navigator.clipboard.writeText(webhookUrl);
    setCopiedWebhook(true);
    setTimeout(() => setCopiedWebhook(false), 2000);
  };

  if (isLoading) return <div className="text-slate-400 py-4">{t("common.loading", "Chargement...")}</div>;

  return (
    <div className="space-y-8 max-w-2xl">
      {toast && (
        <div className="p-3.5 bg-emerald-50 text-emerald-800 border border-emerald-200/80 rounded-xl text-sm font-medium flex items-center gap-2.5 shadow-xs">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{toast}</span>
        </div>
      )}

      {/* ─── Delivery Providers Section ─── */}
      <div className="space-y-5">
        <div>
          <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
            <Truck className="w-4 h-4 text-primary-600" />
            {t("deliveries.add_new_provider", "Ajouter un transporteur")}
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Connectez vos comptes transporteurs algériens pour la génération automatique de bordereaux
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200/80 bg-slate-50/50 p-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
              {t("deliveries.provider", "Transporteur")}
            </label>
            <select
              className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-4 focus:ring-primary-500/10 transition-all font-medium"
              value={newConfig.provider}
              onChange={(e) => setNewConfig({ ...newConfig, provider: e.target.value })}
            >
              <option value="yalidine">Yalidine Express</option>
              <option value="zr_express">ZR Express</option>
              <option value="maystro">Maystro Delivery</option>
              <option value="noest">NOEST</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
              {t("deliveries.api_id", "API ID / Token")}
            </label>
            <input
              className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-primary-500 focus:outline-none focus:ring-4 focus:ring-primary-500/10 transition-all font-mono"
              placeholder="Ex: 87f89d..."
              value={newConfig.api_id}
              onChange={(e) => setNewConfig({ ...newConfig, api_id: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
              {t("deliveries.api_secret", "API Secret / Clé Secrète")}
            </label>
            <input
              type="password"
              className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-primary-500 focus:outline-none focus:ring-4 focus:ring-primary-500/10 transition-all font-mono"
              placeholder="Ex: 9a8b7c6d5e4f..."
              value={newConfig.api_secret}
              onChange={(e) => setNewConfig({ ...newConfig, api_secret: e.target.value })}
            />
          </div>
          <div className="flex justify-end pt-2">
            <button
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary-600 hover:bg-primary-700 text-white text-xs font-semibold shadow-xs shadow-primary-500/20 disabled:opacity-50 transition-all cursor-pointer"
              onClick={handleAdd}
              disabled={!newConfig.api_id || saveMutation.isPending}
            >
              <Plus className="w-4 h-4" />
              <span>{t("common.add", "Ajouter")}</span>
            </button>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
          {t("deliveries.configured_providers", "Transporteurs configurés")}
        </h3>
        {configs.map((config: any) => (
          <div
            key={config.id}
            className="flex items-center justify-between p-4 rounded-2xl border border-slate-200/80 bg-white shadow-xs hover:border-slate-300 transition-all"
          >
            <div>
              <div className="font-bold text-slate-900 text-sm capitalize">
                {config.provider.replace("_", " ")}
              </div>
              <div className="text-xs text-slate-500 font-mono mt-1">API ID: {config.api_id}</div>
              <div className="text-xs text-slate-500 mt-1 flex items-center gap-1.5">
                <span>{t("common.status", "Statut")}:</span>
                <span
                  className={cn(
                    "inline-flex items-center px-2 py-0.5 rounded-full text-2xs font-semibold border",
                    config.is_active
                      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                      : "bg-rose-50 text-rose-700 border-rose-200"
                  )}
                >
                  {config.is_active ? t("common.active", "Actif") : t("common.inactive", "Inactif")}
                </span>
              </div>
            </div>
            <button
              className="text-rose-600 hover:text-rose-700 hover:bg-rose-50 p-2 rounded-xl transition-colors cursor-pointer"
              onClick={() => deleteMutation.mutate(config.id)}
              title={t("deliveries.delete_provider")}
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
        {configs.length === 0 && (
          <div className="text-center p-8 text-slate-400 border border-dashed border-slate-200 rounded-2xl text-xs">
            {t("deliveries.no_providers", "Aucun transporteur configuré.")}
          </div>
        )}
      </div>

      <hr className="border-slate-100" />

      {/* ─── Social Automations Section ─── */}
      <div className="space-y-5">
        <div>
          <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary-600" />
            {t("deliveries.social_automations", "Commandes Réseaux Sociaux & IA")}
          </h3>
          <p className="text-xs text-slate-500 mt-1">
            {t(
              "deliveries.social_automations_desc",
              "Connectez vos pages Messenger et Instagram pour automatiser la saisie des commandes par messagerie"
            )}
          </p>
        </div>

        {/* Webhook URL Display */}
        <div className="p-4 rounded-2xl border border-primary-200/80 bg-primary-50/40 space-y-2">
          <label className="block text-xs font-bold text-primary-800 uppercase tracking-wider">
            {t("deliveries.webhook_url", "URL Webhook Meta")}
          </label>
          <p className="text-xs text-slate-600">
            {t(
              "deliveries.webhook_url_desc",
              "Collez cette URL dans la console Meta for Developers (Webhooks > Messenger)"
            )}
          </p>
          <div className="flex items-center gap-2 pt-1">
            <code className="flex-1 text-xs bg-white px-3 py-2 rounded-xl border border-primary-200 font-mono text-slate-800 truncate shadow-2xs">
              {webhookUrl}
            </code>
            <button
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-primary-200 bg-white hover:bg-primary-50 text-primary-700 text-xs font-semibold shadow-2xs transition-all cursor-pointer"
              onClick={copyWebhookUrl}
            >
              {copiedWebhook ? (
                <Check className="w-3.5 h-3.5 text-emerald-600" />
              ) : (
                <Copy className="w-3.5 h-3.5 text-primary-600" />
              )}
              <span>{copiedWebhook ? "Copié" : "Copier"}</span>
            </button>
          </div>
        </div>

        {/* True 1-Click Facebook Connect */}
        <div className="p-6 rounded-2xl border border-slate-200/80 bg-slate-50/50 text-center space-y-3">
          <h4 className="font-bold text-slate-900 text-sm">
            {t("deliveries.add_social_integration", "Connexion 1-Clic")}
          </h4>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            Connectez vos pages Facebook et comptes Instagram professionnels en un clic pour synchroniser automatiquement les commandes reçues en message privé.
          </p>
          <button
            className="inline-flex items-center justify-center gap-2.5 px-5 py-2.5 rounded-xl bg-[#1877F2] hover:bg-[#0C63D4] text-white text-xs font-semibold shadow-xs transition-all cursor-pointer mx-auto"
            onClick={async () => {
              try {
                const res = await api.get("/deliveries/meta-oauth/url/");
                window.location.href = res.data.url;
              } catch (err) {
                setToast(getApiError(err));
              }
            }}
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current" xmlns="http://www.w3.org/2000/svg">
              <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.469h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.469h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
            </svg>
            <span>{t("deliveries.connect_facebook")}</span>
          </button>
        </div>

        {/* Configured Social Integrations */}
        <div className="space-y-3">
          {socialConfigs.map((sc: any) => (
            <div
              key={sc.id}
              className="flex items-center justify-between p-4 rounded-2xl border border-slate-200/80 bg-white shadow-xs hover:border-slate-300 transition-all"
            >
              <div className="flex items-center gap-3">
                <div
                  className={cn(
                    "w-10 h-10 rounded-xl flex items-center justify-center shrink-0 shadow-2xs",
                    sc.platform === "facebook"
                      ? "bg-blue-50 text-[#1877F2] border border-blue-100"
                      : "bg-gradient-to-br from-purple-500 to-pink-500 text-white"
                  )}
                >
                  {sc.platform === "facebook" ? (
                    <MessageCircle className="w-5 h-5" />
                  ) : (
                    <Instagram className="w-5 h-5" />
                  )}
                </div>
                <div>
                  <div className="font-bold text-slate-900 text-sm">
                    {sc.page_name || sc.page_id}
                  </div>
                  <div className="text-xs text-slate-500 flex items-center gap-2 mt-0.5">
                    <span className="capitalize">
                      {sc.platform === "facebook" ? "Messenger" : "Instagram"}
                    </span>
                    <span>·</span>
                    <span className="font-mono">ID: {sc.page_id}</span>
                    {sc.ai_enabled && (
                      <>
                        <span>·</span>
                        <span className="inline-flex items-center gap-1 text-primary-600 font-semibold">
                          <Sparkles className="w-3 h-3" /> IA
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "inline-flex items-center px-2 py-0.5 rounded-full text-2xs font-semibold border",
                    sc.is_active
                      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                      : "bg-rose-50 text-rose-700 border-rose-200"
                  )}
                >
                  {sc.is_active ? t("common.active", "Actif") : t("common.inactive", "Inactif")}
                </span>
                <button
                  className="text-rose-600 hover:text-rose-700 hover:bg-rose-50 p-2 rounded-xl transition-colors cursor-pointer"
                  onClick={() => socialDeleteMutation.mutate(sc.id)}
                  title={t("deliveries.delete_integration")}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
          {socialConfigs.length === 0 && (
            <div className="text-center p-8 text-slate-400 border border-dashed border-slate-200 rounded-2xl text-xs">
              {t("deliveries.no_social_integrations", "Aucune intégration sociale configurée.")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
