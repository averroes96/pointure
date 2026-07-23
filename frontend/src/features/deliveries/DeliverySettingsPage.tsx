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
      setToast("Settings saved");
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

  if (isLoading) return <div>Loading...</div>;

  return (
    <div className="max-w-4xl p-6">
      <h1 className="text-2xl font-bold mb-6">Delivery Integrations (dzship)</h1>
      {toast && <div className="mb-4 p-3 bg-green-100 text-green-800 rounded">{toast}</div>}

      <div className="bg-white p-6 rounded-lg shadow-sm border border-border mb-8">
        <h2 className="text-lg font-semibold mb-4">Add New Provider</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
          <select
            className="input"
            value={newConfig.provider}
            onChange={(e) => setNewConfig({ ...newConfig, provider: e.target.value })}
          >
            <option value="yalidine">Yalidine</option>
            <option value="zr_express">ZR Express</option>
            <option value="maystro">Maystro Delivery</option>
            <option value="noest">NOEST</option>
          </select>
          <input
            className="input"
            placeholder="API ID / Token"
            value={newConfig.api_id}
            onChange={(e) => setNewConfig({ ...newConfig, api_id: e.target.value })}
          />
          <input
            className="input"
            placeholder="API Secret / Key"
            value={newConfig.api_secret}
            onChange={(e) => setNewConfig({ ...newConfig, api_secret: e.target.value })}
          />
          <button
            className="btn-primary flex items-center justify-center gap-2"
            onClick={handleAdd}
            disabled={!newConfig.api_id || saveMutation.isPending}
          >
            <Plus className="w-4 h-4" /> Add
          </button>
        </div>
      </div>

      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Configured Providers</h2>
        {configs.map((config: any) => (
          <div key={config.id} className="bg-white p-6 rounded-lg shadow-sm border border-border flex items-center justify-between">
            <div>
              <div className="font-medium text-lg capitalize">{config.provider.replace("_", " ")}</div>
              <div className="text-sm text-text-muted">API ID: {config.api_id}</div>
              <div className="text-sm text-text-muted mt-1">
                Status: <span className={cn("px-2 py-0.5 rounded text-xs", config.is_active ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800")}>
                  {config.is_active ? "Active" : "Inactive"}
                </span>
              </div>
            </div>
            <button
              className="text-red-600 hover:bg-red-50 p-2 rounded"
              onClick={() => deleteMutation.mutate(config.id)}
            >
              <Trash2 className="w-5 h-5" />
            </button>
          </div>
        ))}
        {configs.length === 0 && (
          <div className="text-center p-8 text-text-muted border border-dashed border-border rounded-lg">
            No providers configured yet.
          </div>
        )}
      </div>
    </div>
  );
}
