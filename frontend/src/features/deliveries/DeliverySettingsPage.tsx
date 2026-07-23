import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Save, Plus, Trash2 } from "lucide-react";
import api, { getApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

export default function DeliverySettingsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [toast, setToast] = useState<string | null>(null);

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

  if (isLoading) return <div>{t("common.loading", "Loading...")}</div>;

  return (
    <div className="space-y-6 max-w-lg">
      {toast && <div className="p-3 bg-success-light text-success border border-success/20 rounded text-sm">{toast}</div>}

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

      <hr className="border-border" />

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
    </div>
  );
}
