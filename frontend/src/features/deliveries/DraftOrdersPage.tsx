import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Truck, Check, X, Package, Plus } from "lucide-react";
import api, { getApiError, formatDate } from "@/lib/api";
import { cn, getStatusBadgeClass } from "@/lib/utils";

export default function DraftOrdersPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [toast, setToast] = useState<string | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<any>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [newOrder, setNewOrder] = useState({
    customer_name: "",
    customer_phone: "",
    wilaya: "16",
    commune: "",
    address: "",
    customer_notes: "",
    source: "manual"
  });

  const { data: ordersData, isLoading } = useQuery({
    queryKey: ["customer-orders"],
    queryFn: async () => {
      const res = await api.get("/deliveries/customer-orders/");
      return res.data.results || res.data;
    },
  });

  const { data: providersData } = useQuery({
    queryKey: ["provider-configs"],
    queryFn: async () => {
      const res = await api.get("/deliveries/provider-configs/");
      return res.data.results || res.data;
    },
  });

  const dispatchMutation = useMutation({
    mutationFn: (data: any) => api.post(`/deliveries/customer-orders/${data.id}/dispatch_order/`, data.payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customer-orders"] });
      setToast(t("deliveries.dispatch_success"));
      setSelectedOrder(null);
      setTimeout(() => setToast(null), 5000);
    },
    onError: (err) => setToast(getApiError(err)),
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => api.post("/deliveries/customer-orders/", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customer-orders"] });
      setToast(t("deliveries.draft_created", "Manual draft order created successfully!"));
      setIsCreating(false);
      setNewOrder({
        customer_name: "", customer_phone: "", wilaya: "16", commune: "", address: "", customer_notes: "", source: "manual"
      });
      setTimeout(() => setToast(null), 5000);
    },
    onError: (err) => setToast(getApiError(err)),
  });

  if (isLoading) return <div>{t("common.loading", "Loading...")}</div>;

  const orders = ordersData || [];
  const providers = providersData || [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-text-primary">{t("deliveries.draft_orders_title")}</h1>
        </div>
        <button className="btn-primary flex items-center gap-2" onClick={() => { setIsCreating(true); setSelectedOrder(null); }}>
          <Plus size={16} /> {t("deliveries.new_manual_order", "New Manual Order")}
        </button>
      </div>

      {toast && <div className="p-3 bg-success-light text-success border border-success/20 rounded">{toast}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          {orders.map((order: any) => (
            <div key={order.id} className="card p-5">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="font-semibold text-lg text-text-primary">{order.customer_name}</h3>
                  <div className="text-sm text-text-muted">{order.customer_phone}</div>
                </div>
                <span className={cn("px-2 py-1 text-xs font-medium rounded capitalize", order.status === 'draft' ? 'bg-amber-100 text-amber-800' : 'bg-primary-50 text-primary-600')}>
                  {order.status}
                </span>
              </div>
              
              <div className="grid grid-cols-2 gap-4 text-sm mb-4">
                <div>
                  <span className="text-text-muted block text-xs">{t("deliveries.source")}</span>
                  <span className="capitalize">{order.source}</span>
                </div>
                <div>
                  <span className="text-text-muted block text-xs">{t("deliveries.destination")}</span>
                  {order.wilaya}, {order.commune}
                </div>
                <div className="col-span-2">
                  <span className="text-text-muted block text-xs">{t("deliveries.customer_notes")}</span>
                  <p className="bg-bg-alt p-3 rounded text-text-primary mt-1 whitespace-pre-wrap">
                    {order.customer_notes || t("deliveries.no_notes")}
                  </p>
                </div>
              </div>

              {order.status === "draft" && (
                <button
                  className="btn-primary"
                  onClick={() => { setSelectedOrder(order); setIsCreating(false); }}
                >
                  {t("deliveries.validate_and_dispatch")}
                </button>
              )}
              {order.tracking_number && (
                <div className="mt-4 p-3 bg-bg-alt rounded flex items-center gap-2 text-sm">
                  <Package className="w-4 h-4" />
                  {t("deliveries.tracking")}: <span className="font-semibold">{order.tracking_number}</span> ({order.provider})
                </div>
              )}
            </div>
          ))}
          {orders.length === 0 && (
            <div className="text-center p-8 text-text-muted border border-dashed border-border rounded-lg">
              {t("deliveries.no_draft_orders")}
            </div>
          )}
        </div>

        {/* Dispatch Sidebar */}
        {selectedOrder && (
          <div className="card p-5 h-fit sticky top-24">
            <h2 className="text-lg font-bold mb-4 text-text-primary">{t("deliveries.dispatch_order")}</h2>
            <div className="mb-4">
              <label className="form-label">{t("deliveries.select_provider")}</label>
              <select id="providerSelect" className="form-input">
                {providers.filter((p: any) => p.is_active).map((p: any) => (
                  <option key={p.id} value={p.provider}>{p.provider}</option>
                ))}
              </select>
            </div>
            
            <div className="mb-4">
              <label className="form-label">{t("deliveries.shipping_fee")}</label>
              <input id="shippingFee" type="number" defaultValue="600" className="form-input" />
            </div>

            <div className="mb-6 p-4 border border-border rounded bg-surface">
              <label className="form-label mb-2">{t("deliveries.variant_to_include")}</label>
              <input id="variantId" type="text" placeholder="Variant UUID" className="form-input mb-2 text-sm font-mono" />
              <input id="qty" type="number" defaultValue="1" className="form-input mb-2" min="1" />
            </div>

            <div className="flex gap-2">
              <button 
                className="btn-primary flex-1 flex items-center justify-center gap-2"
                onClick={() => {
                  const provider = (document.getElementById('providerSelect') as HTMLSelectElement).value;
                  const shipping_fee = (document.getElementById('shippingFee') as HTMLInputElement).value;
                  const variantId = (document.getElementById('variantId') as HTMLInputElement).value;
                  const qty = (document.getElementById('qty') as HTMLInputElement).value;
                  
                  if (!variantId) {
                    setToast(t("deliveries.missing_variant_id"));
                    return;
                  }

                  dispatchMutation.mutate({
                    id: selectedOrder.id,
                    payload: {
                      provider,
                      shipping_fee,
                      variant_ids: [variantId],
                      quantities: [parseInt(qty)]
                    }
                  });
                }}
                disabled={dispatchMutation.isPending}
              >
                <Truck className="w-4 h-4" /> Dispatch
              </button>
              <button className="btn-secondary" onClick={() => setSelectedOrder(null)}>Cancel</button>
            </div>
          </div>
        )}

        {/* Creation Sidebar */}
        {isCreating && !selectedOrder && (
          <div className="card p-5 h-fit sticky top-24">
            <h2 className="text-lg font-bold mb-4 text-text-primary">{t("deliveries.new_manual_order", "New Manual Order")}</h2>
            
            <div className="space-y-4">
              <div>
                <label className="form-label">{t("client.name", "Name")}</label>
                <input className="form-input" value={newOrder.customer_name} onChange={(e) => setNewOrder({...newOrder, customer_name: e.target.value})} />
              </div>
              <div>
                <label className="form-label">{t("client.phone", "Phone")}</label>
                <input className="form-input" value={newOrder.customer_phone} onChange={(e) => setNewOrder({...newOrder, customer_phone: e.target.value})} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="form-label">{t("client.wilaya", "Wilaya")}</label>
                  <input className="form-input" placeholder="Ex: 16" value={newOrder.wilaya} onChange={(e) => setNewOrder({...newOrder, wilaya: e.target.value})} />
                </div>
                <div>
                  <label className="form-label">{t("client.commune", "Commune")}</label>
                  <input className="form-input" value={newOrder.commune} onChange={(e) => setNewOrder({...newOrder, commune: e.target.value})} />
                </div>
              </div>
              <div>
                <label className="form-label">{t("deliveries.customer_notes", "Customer Notes")}</label>
                <textarea className="form-input" rows={3} value={newOrder.customer_notes} onChange={(e) => setNewOrder({...newOrder, customer_notes: e.target.value})}></textarea>
              </div>
            </div>

            <div className="flex gap-2 mt-6">
              <button 
                className="btn-primary flex-1 flex items-center justify-center"
                onClick={() => createMutation.mutate(newOrder)}
                disabled={createMutation.isPending || !newOrder.customer_name || !newOrder.customer_phone}
              >
                {createMutation.isPending ? t("common.saving", "Saving...") : t("common.save", "Save")}
              </button>
              <button 
                className="btn-secondary flex-1"
                onClick={() => setIsCreating(false)}
              >
                {t("common.cancel", "Cancel")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
