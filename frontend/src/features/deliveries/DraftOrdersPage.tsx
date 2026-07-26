import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Truck, Check, X, Package, Plus, Trash2, MessageCircle, Laptop } from "lucide-react";
import api, { getApiError, formatDate } from "@/lib/api";
import { cn, getStatusBadgeClass } from "@/lib/utils";
import { useWilayas, useCommunes } from "@/hooks/useLocationData";
import { VariantSearchInput } from "@/components/ui/VariantSearchInput";
import type { Variant } from "@/types";

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

  const { data: wilayas } = useWilayas();
  const { data: communes } = useCommunes(newOrder.wilaya);
  const { data: selectedCommunes } = useCommunes(selectedOrder?.wilaya || "16");
  
  const [dispatchItems, setDispatchItems] = useState<{variant: Variant, quantity: number}[]>([]);

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

  const updateMutation = useMutation({
    mutationFn: (data: any) => api.patch(`/deliveries/customer-orders/${data.id}/`, data.payload),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/deliveries/customer-orders/${id}/`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customer-orders"] });
      setToast(t("deliveries.draft_deleted", "Draft order deleted successfully!"));
      setSelectedOrder(null);
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
                  <h3 className="font-semibold text-lg text-text-primary">{order.customer_name || <span className="text-text-muted italic">Unnamed Customer</span>}</h3>
                  <div className="text-sm text-text-muted">{order.customer_phone || <span className="italic">No Phone Number</span>}</div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={cn("px-2 py-1 text-xs font-medium rounded capitalize", order.status === 'draft' ? 'bg-amber-100 text-amber-800' : 'bg-primary-50 text-primary-600')}>
                    {order.status}
                  </span>
                  {order.status === 'draft' && (
                    <button 
                      onClick={() => {
                        if (confirm(t("deliveries.confirm_delete", "Are you sure you want to delete this draft order?"))) {
                          deleteMutation.mutate(order.id);
                        }
                      }}
                      className="p-1.5 text-error/80 hover:text-error hover:bg-error/10 rounded transition-colors"
                      title="Delete Draft"
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4 text-sm mb-4">
                <div>
                  <span className="text-text-muted block text-xs">{t("deliveries.source")}</span>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    {order.source === 'messenger' ? <MessageCircle size={14} className="text-blue-500" /> : order.source === 'instagram' ? <MessageCircle size={14} className="text-pink-500" /> : <Laptop size={14} className="text-text-muted" />}
                    <span className="capitalize text-text-primary">{order.source}</span>
                  </div>
                </div>
                <div>
                  <span className="text-text-muted block text-xs">{t("deliveries.destination")}</span>
                  <div className="mt-0.5 text-text-primary">
                    {order.wilaya ? `${order.wilaya}, ${order.commune}` : <span className="text-text-muted italic">Unknown</span>}
                  </div>
                </div>
                <div className="col-span-2">
                  <span className="text-text-muted block text-xs mb-1">{t("deliveries.customer_notes")}</span>
                  <p className="bg-bg-alt/50 border border-border p-3 rounded-lg text-text-secondary text-sm whitespace-pre-wrap line-clamp-3">
                    {order.customer_notes || <span className="italic text-text-muted">{t("deliveries.no_notes", "No notes available.")}</span>}
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
            <div className="mb-4 space-y-3 p-4 border border-border rounded bg-surface">
              <h3 className="font-semibold text-sm text-text-primary mb-2">Edit Customer Details</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="form-label text-xs">Name</label>
                  <input className="form-input text-sm" value={selectedOrder.customer_name || ''} onChange={(e) => setSelectedOrder({...selectedOrder, customer_name: e.target.value})} />
                </div>
                <div>
                  <label className="form-label text-xs">Phone</label>
                  <input className="form-input text-sm" value={selectedOrder.customer_phone || ''} onChange={(e) => setSelectedOrder({...selectedOrder, customer_phone: e.target.value})} />
                </div>
                <div>
                  <label className="form-label text-xs">Wilaya</label>
                  <select className="form-input text-sm" value={selectedOrder.wilaya || ''} onChange={(e) => setSelectedOrder({...selectedOrder, wilaya: e.target.value, commune: ""})}>
                    <option value="">Select Wilaya</option>
                    {wilayas?.map((w: any) => <option key={w.code} value={w.code}>{w.code} - {w.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="form-label text-xs">Commune</label>
                  <select className="form-input text-sm" value={selectedOrder.commune || ''} onChange={(e) => setSelectedOrder({...selectedOrder, commune: e.target.value})}>
                    <option value="">Select Commune</option>
                    {selectedCommunes?.map((c: any) => <option key={c.name} value={c.name}>{c.name}</option>)}
                  </select>
                </div>
              </div>
            </div>

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
              <div className="mb-2">
                <VariantSearchInput 
                  value={null} 
                  onSelect={(v) => {
                    setDispatchItems(prev => {
                      if (prev.find(item => item.variant.id === v.id)) return prev;
                      return [...prev, { variant: v, quantity: 1 }];
                    });
                  }} 
                />
              </div>
              
              {dispatchItems.length > 0 && (
                <div className="flex flex-col gap-2 mt-3 max-h-48 overflow-y-auto">
                  {dispatchItems.map((item, index) => (
                    <div key={item.variant.id} className="flex items-center gap-2 bg-background p-2 rounded border border-border text-sm">
                      <div className="flex-1 min-w-0">
                        <div className="truncate font-medium text-text-primary">{item.variant.product_name}</div>
                        <div className="text-xs text-text-muted truncate">
                          T{item.variant.size_eu} · {item.variant.colour === "N/A" ? "N/A" : item.variant.colour}
                        </div>
                      </div>
                      <input 
                        type="number" 
                        min="1"
                        className="form-input w-20 h-8 text-sm text-center"
                        value={item.quantity}
                        onChange={(e) => {
                          const val = parseInt(e.target.value) || 1;
                          setDispatchItems(prev => prev.map((p, i) => i === index ? { ...p, quantity: val } : p));
                        }}
                      />
                      <button 
                        className="p-1.5 text-text-muted hover:text-danger hover:bg-danger/10 rounded transition-colors"
                        onClick={() => setDispatchItems(prev => prev.filter((_, i) => i !== index))}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex gap-2">
              <button 
                className="btn-primary flex-1 flex items-center justify-center gap-2"
                onClick={async () => {
                  const provider = (document.getElementById('providerSelect') as HTMLSelectElement).value;
                  const shipping_fee = (document.getElementById('shippingFee') as HTMLInputElement).value;
                  
                  if (dispatchItems.length === 0) {
                    setToast(t("deliveries.missing_variant_id"));
                    return;
                  }

                  try {
                    // Update the draft order details first
                    await updateMutation.mutateAsync({
                      id: selectedOrder.id,
                      payload: {
                        customer_name: selectedOrder.customer_name,
                        customer_phone: selectedOrder.customer_phone,
                        wilaya: selectedOrder.wilaya,
                        commune: selectedOrder.commune,
                      }
                    });

                    // Then dispatch it
                    dispatchMutation.mutate({
                      id: selectedOrder.id,
                      payload: {
                        provider,
                        shipping_fee,
                        variant_ids: dispatchItems.map(item => item.variant.id),
                        quantities: dispatchItems.map(item => item.quantity)
                      }
                    });
                  } catch (e) {
                    setToast("Failed to update customer details.");
                  }
                }}
                disabled={dispatchMutation.isPending || updateMutation.isPending}
              >
                <Truck className="w-4 h-4" /> Dispatch
              </button>
              <button 
                className="btn-danger flex items-center justify-center gap-2 px-3"
                onClick={() => {
                  if (confirm(t("deliveries.confirm_delete", "Are you sure you want to delete this draft order?"))) {
                    deleteMutation.mutate(selectedOrder.id);
                  }
                }}
                disabled={deleteMutation.isPending}
                title="Delete Draft"
              >
                <Trash2 className="w-4 h-4" />
              </button>
              <button className="btn-secondary" onClick={() => { setSelectedOrder(null); setDispatchItems([]); }}>Cancel</button>
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
                  <select 
                    className="form-input" 
                    value={newOrder.wilaya} 
                    onChange={(e) => {
                      // When wilaya changes, reset commune
                      setNewOrder({...newOrder, wilaya: e.target.value, commune: ""});
                    }}
                  >
                    <option value="">{t("common.select", "Select...")}</option>
                    {wilayas?.map((w) => (
                      <option key={w.id} value={w.code}>{w.code} - {w.name} ({w.ar_name})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="form-label">{t("client.commune", "Commune")}</label>
                  <select 
                    className="form-input" 
                    value={newOrder.commune} 
                    onChange={(e) => setNewOrder({...newOrder, commune: e.target.value})}
                    disabled={!newOrder.wilaya}
                  >
                    <option value="">{t("common.select", "Select...")}</option>
                    {communes?.map((c) => (
                      <option key={c.id} value={c.name}>{c.name} ({c.ar_name})</option>
                    ))}
                  </select>
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
