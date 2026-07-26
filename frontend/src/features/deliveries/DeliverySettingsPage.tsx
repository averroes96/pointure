import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Save, Plus, Trash2, MessageCircle, Instagram, Copy, Check, Sparkles } from "lucide-react";
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
      setToast(t("deliveries.settings_saved"));
      setTimeout(() => setToast(null), 3000);
    },
    onError: (err) => setToast(getApiError(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/deliveries/provider-configs/${id}/`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["provider-configs"] }),
  });

  const [newConfig, setNewConfig] = useState({ provider: "yalidine", api_id: "", api_secret: "", is_active: true });

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

  const socialSaveMutation = useMutation({
    mutationFn: (data: any) => {
      if (data.id) return api.put(`/deliveries/social-integrations/${data.id}/`, data);
      return api.post("/deliveries/social-integrations/", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["social-integrations"] });
      setToast(t("deliveries.social_saved"));
      setTimeout(() => setToast(null), 3000);
    },
    onError: (err) => setToast(getApiError(err)),
  });

  const socialDeleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/deliveries/social-integrations/${id}/`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["social-integrations"] }),
  });

  const [newSocial, setNewSocial] = useState({
    platform: "facebook",
    page_id: "",
    page_name: "",
    access_token: "",
    is_active: true,
    ai_enabled: true,
  });

  const handleAddSocial = () => {
    socialSaveMutation.mutate(newSocial);
    setNewSocial({ platform: "facebook", page_id: "", page_name: "", access_token: "", is_active: true, ai_enabled: true });
  };

  // Build the webhook URL dynamically
  const webhookUrl = `${window.location.origin}/api/v1/deliveries/meta-webhook/`;

  const copyWebhookUrl = () => {
    navigator.clipboard.writeText(webhookUrl);
    setCopiedWebhook(true);
    setTimeout(() => setCopiedWebhook(false), 2000);
  };

  if (isLoading) return <div>{t("common.loading", "Loading...")}</div>;

  return (
    <div className="space-y-8 max-w-2xl">
      {toast && <div className="p-3 bg-success-light text-success border border-success/20 rounded text-sm">{toast}</div>}

      {/* ─── Delivery Providers Section ─── */}
      <div className="space-y-4">
        <h3 className="font-semibold text-text-primary text-base">{t("deliveries.add_new_provider")}</h3>
        <div className="grid grid-cols-1 gap-4">
          <div>
            <label className="form-label">{t("deliveries.provider", "Provider")}</label>
            <select
              className="form-input"
              value={newConfig.provider}
              onChange={(e) => setNewConfig({ ...newConfig, provider: e.target.value })}
            >
              <option value="yalidine">Yalidine</option>
              <option value="zr_express">ZR Express</option>
              <option value="maystro">Maystro Delivery</option>
              <option value="noest">NOEST</option>
            </select>
          </div>
          <div>
            <label className="form-label">{t("deliveries.api_id", "API ID / Token")}</label>
            <input
              className="form-input"
              placeholder="Ex: 87f89d..."
              value={newConfig.api_id}
              onChange={(e) => setNewConfig({ ...newConfig, api_id: e.target.value })}
            />
          </div>
          <div>
            <label className="form-label">{t("deliveries.api_secret", "API Secret / Key")}</label>
            <input
              className="form-input"
              placeholder="Ex: 9a8b7c6d5e4f..."
              value={newConfig.api_secret}
              onChange={(e) => setNewConfig({ ...newConfig, api_secret: e.target.value })}
            />
          </div>
          <div className="flex justify-end pt-2">
            <button
              className="btn-primary flex items-center justify-center gap-2"
              onClick={handleAdd}
              disabled={!newConfig.api_id || saveMutation.isPending}
            >
              <Plus className="w-4 h-4" /> {t("common.add", "Add")}
            </button>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="font-medium text-text-primary">{t("deliveries.configured_providers")}</h3>
        {configs.map((config: any) => (
          <div key={config.id} className="flex items-center justify-between p-4 rounded-lg border border-border bg-surface">
            <div>
              <div className="font-medium text-text-primary capitalize">{config.provider.replace("_", " ")}</div>
              <div className="text-sm text-text-muted mt-1">API ID: {config.api_id}</div>
              <div className="text-sm text-text-muted mt-1">
                {t("common.status", "Status")}: <span className={cn("px-2 py-0.5 rounded text-xs ml-1", config.is_active ? "bg-success-light text-success" : "bg-danger-light text-danger")}>
                  {config.is_active ? t("common.active", "Active") : t("common.inactive", "Inactive")}
                </span>
              </div>
            </div>
            <button
              className="text-danger hover:bg-danger-light p-2 rounded transition-colors"
              onClick={() => deleteMutation.mutate(config.id)}
            >
              <Trash2 className="w-5 h-5" />
            </button>
          </div>
        ))}
        {configs.length === 0 && (
          <div className="text-center p-8 text-text-muted border border-dashed border-border rounded-lg">
            {t("deliveries.no_providers")}
          </div>
        )}
      </div>

      <hr className="border-border" />

      {/* ─── Social Automations Section ─── */}
      <div className="space-y-5">
        <div>
          <h3 className="font-semibold text-text-primary text-base flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            {t("deliveries.social_automations")}
          </h3>
          <p className="text-sm text-text-muted mt-1">{t("deliveries.social_automations_desc")}</p>
        </div>

        {/* Webhook URL Display */}
        <div className="p-4 rounded-lg border border-primary/20 bg-primary/5">
          <label className="form-label text-primary font-medium">{t("deliveries.webhook_url")}</label>
          <p className="text-xs text-text-muted mb-2">{t("deliveries.webhook_url_desc")}</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs bg-background px-3 py-2 rounded border border-border font-mono truncate">
              {webhookUrl}
            </code>
            <button
              className="btn-secondary flex items-center gap-1.5 text-xs px-3 py-2"
              onClick={copyWebhookUrl}
            >
              {copiedWebhook ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
              {copiedWebhook ? "Copié" : "Copier"}
            </button>
          </div>
        </div>

        {/* True 1-Click Facebook Connect */}
        <div className="p-5 rounded-lg border border-border bg-surface text-center space-y-3">
          <h4 className="font-medium text-text-primary text-sm">{t("deliveries.add_social_integration")}</h4>
          <p className="text-xs text-text-muted">
            Connect your Facebook Pages and Instagram Business accounts in one click to automatically receive and parse incoming orders.
          </p>
          <button
            className="btn-primary w-full max-w-xs mx-auto flex items-center justify-center gap-2 bg-[#1877F2] hover:bg-[#0C63D4] border-transparent text-white"
            onClick={async () => {
              try {
                const res = await api.get('/deliveries/meta-oauth/url/');
                window.location.href = res.data.url;
              } catch (err) {
                setToast(getApiError(err));
              }
            }}
          >
            <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current" xmlns="http://www.w3.org/2000/svg">
              <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.469h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.469h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
            </svg>
            Connect with Facebook
          </button>
        </div>

        {/* Configured Social Integrations */}
        <div className="space-y-3">
          {socialConfigs.map((sc: any) => (
            <div key={sc.id} className="flex items-center justify-between p-4 rounded-lg border border-border bg-surface">
              <div className="flex items-center gap-3">
                <div className={cn(
                  "w-10 h-10 rounded-full flex items-center justify-center",
                  sc.platform === "facebook" ? "bg-blue-100 text-blue-600" : "bg-gradient-to-br from-purple-500 to-pink-500 text-white"
                )}>
                  {sc.platform === "facebook" ? <MessageCircle className="w-5 h-5" /> : <Instagram className="w-5 h-5" />}
                </div>
                <div>
                  <div className="font-medium text-text-primary">
                    {sc.page_name || sc.page_id}
                  </div>
                  <div className="text-xs text-text-muted flex items-center gap-2 mt-0.5">
                    <span className="capitalize">{sc.platform === "facebook" ? "Messenger" : "Instagram"}</span>
                    <span>·</span>
                    <span>ID: {sc.page_id}</span>
                    {sc.ai_enabled && (
                      <>
                        <span>·</span>
                        <span className="inline-flex items-center gap-1 text-primary">
                          <Sparkles className="w-3 h-3" /> IA
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={cn("px-2 py-0.5 rounded text-xs", sc.is_active ? "bg-success-light text-success" : "bg-danger-light text-danger")}>
                  {sc.is_active ? t("common.active", "Active") : t("common.inactive", "Inactive")}
                </span>
                <button
                  className="text-danger hover:bg-danger-light p-2 rounded transition-colors"
                  onClick={() => socialDeleteMutation.mutate(sc.id)}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
          {socialConfigs.length === 0 && (
            <div className="text-center p-8 text-text-muted border border-dashed border-border rounded-lg">
              {t("deliveries.no_social_integrations")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
