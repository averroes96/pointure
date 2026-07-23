import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Truck, Check, X, Package } from "lucide-react";
import api, { getApiError, formatDate } from "@/lib/api";
import { cn, getStatusBadgeClass } from "@/lib/utils";

export default function DraftOrdersPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [toast, setToast] = useState<string | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<any>(null);

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
      setToast("Order Dispatched Successfully via dzship!");
      setSelectedOrder(null);
      setTimeout(() => setToast(null), 5000);
    },
    onError: (err) => setToast(getApiError(err)),
  });

  if (isLoading) return <div>Loading...</div>;

  const orders = ordersData || [];
  const providers = providersData || [];

  return (
    <div className="max-w-6xl p-6">
      <h1 className="text-2xl font-bold mb-6">WhatsApp & Draft Orders</h1>
      {toast && <div className="mb-4 p-3 bg-green-100 text-green-800 rounded">{toast}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          {orders.map((order: any) => (
            <div key={order.id} className="bg-white p-6 rounded-lg shadow-sm border border-border">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="font-semibold text-lg">{order.customer_name}</h3>
                  <div className="text-sm text-text-muted">{order.customer_phone}</div>
                </div>
                <span className={cn("px-2 py-1 text-xs font-medium rounded capitalize", order.status === 'draft' ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800')}>
                  {order.status}
                </span>
              </div>
              
              <div className="grid grid-cols-2 gap-4 text-sm mb-4">
                <div>
                  <span className="text-text-muted block text-xs">Source</span>
                  <span className="capitalize">{order.source}</span>
                </div>
                <div>
                  <span className="text-text-muted block text-xs">Destination</span>
                  {order.wilaya}, {order.commune}
                </div>
                <div className="col-span-2">
                  <span className="text-text-muted block text-xs">Customer Notes / Requested</span>
                  <p className="bg-bg-alt p-3 rounded text-text-primary mt-1 whitespace-pre-wrap">
                    {order.customer_notes || "No notes"}
                  </p>
                </div>
              </div>

              {order.status === "draft" && (
                <button
                  className="btn-primary"
                  onClick={() => setSelectedOrder(order)}
                >
                  Validate & Dispatch
                </button>
              )}
              {order.tracking_number && (
                <div className="mt-4 p-3 bg-bg-alt rounded flex items-center gap-2 text-sm">
                  <Package className="w-4 h-4" />
                  Tracking: <span className="font-semibold">{order.tracking_number}</span> ({order.provider})
                </div>
              )}
            </div>
          ))}
          {orders.length === 0 && (
            <div className="text-center p-8 text-text-muted border border-dashed border-border rounded-lg">
              No draft orders found.
            </div>
          )}
        </div>

        {/* Dispatch Sidebar */}
        {selectedOrder && (
          <div className="bg-white p-6 rounded-lg shadow-sm border border-border h-fit sticky top-24">
            <h2 className="text-lg font-bold mb-4">Dispatch Order</h2>
            <div className="mb-4">
              <label className="block text-sm font-medium mb-1">Select Provider</label>
              <select id="providerSelect" className="input">
                {providers.filter((p: any) => p.is_active).map((p: any) => (
                  <option key={p.id} value={p.provider}>{p.provider}</option>
                ))}
              </select>
            </div>
            
            <div className="mb-4">
              <label className="block text-sm font-medium mb-1">Shipping Fee (DZD)</label>
              <input id="shippingFee" type="number" defaultValue="600" className="input" />
            </div>

            <div className="mb-6 p-4 border border-border rounded bg-bg-alt">
              <label className="block text-sm font-medium mb-2">Variant to Include</label>
              <input id="variantId" type="text" placeholder="Variant UUID" className="input mb-2 text-sm font-mono" />
              <input id="qty" type="number" defaultValue="1" className="input mb-2" min="1" />
              <p className="text-xs text-text-muted mt-2">
                (In a full implementation, this uses the Pointure product search component to select exactly what the customer described in their notes.)
              </p>
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
                    setToast("Please enter a Variant ID to dispatch.");
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
      </div>
    </div>
  );
}
