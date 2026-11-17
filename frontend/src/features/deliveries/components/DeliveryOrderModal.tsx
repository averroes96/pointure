import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Save, Trash2, Truck, X } from "lucide-react";
import api, { getApiError } from "@/lib/api";
import {
  buildOrderPayload, emptyForm, formFromOrder, readDispatchProblem, toCents, usableAccounts,
  useCourierAccounts, useCourierCommunes, useCourierQuote, useInvalidateOrders, validateOrder,
  type DeliveryOrder, type FormErrors, type OrderForm,
} from "../deliveryOrders";
import OrderAmounts from "./OrderAmounts";
import OrderCustomerFields from "./OrderCustomerFields";
import OrderDestinationFields from "./OrderDestinationFields";
import OrderLinesEditor from "./OrderLinesEditor";

interface Props {
  /** null = a new order. */
  order: DeliveryOrder | null;
  onClose: () => void;
  onDone: (message: string) => void;
}

interface Problem { message: string; courierMessage: string }

/**
 * Create or edit a delivery order, then send it to the courier (docs/plans/delivery-v1-plan.md P2.6).
 * "Send" saves first, so the courier receives exactly what the server has.
 */
export default function DeliveryOrderModal({ order, onClose, onDone }: Props) {
  const { t } = useTranslation();
  const invalidate = useInvalidateOrders();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const [form, setForm] = useState<OrderForm>(() => (order ? formFromOrder(order) : emptyForm()));
  const [orderId, setOrderId] = useState<string | null>(order?.id ?? null);
  const [errors, setErrors] = useState<FormErrors>({});
  const [problem, setProblem] = useState<Problem | null>(null);
  const [initial] = useState(() => ({ wilaya: order?.wilaya ?? "", commune: order?.commune ?? "" }));

  const { data: allAccounts = [] } = useCourierAccounts();
  const accounts = usableAccounts(allAccounts);
  const [accountId, setAccountId] = useState("");
  useEffect(() => {
    if (!accountId && accounts[0]) setAccountId(accounts[0].id);
  }, [accountId, accounts]);

  // The saved commune may be Pointure's spelling: ask the server for the courier's (P2.2).
  const communes = useCourierCommunes(form.wilaya, form.wilaya === initial.wilaya ? initial.commune : "");
  useEffect(() => {
    const match = communes.data?.match;
    if (match && form.commune === initial.commune && match.name_fr !== form.commune) {
      setForm((f) => ({ ...f, commune: match.name_fr }));
    }
  }, [communes.data, form.commune, initial.commune]);

  const quote = useCourierQuote(accountId, communes.data?.ship_wilaya, form.delivery_type, form.commune);
  useEffect(() => {
    const fee = quote.data?.delivery_fee;
    if (!fee) return;
    setForm((f) => ({
      ...f,
      quoted_fee: fee,
      shipping_fee: !f.free_shipping && (toCents(f.shipping_fee) ?? 0) === 0 ? fee : f.shipping_fee,
    }));
  }, [quote.data?.delivery_fee]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCloseRef.current();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const change = (patch: Partial<OrderForm>) => {
    setForm((f) => ({ ...f, ...patch }));
    setProblem(null);
  };

  const save = useMutation({
    mutationFn: async () => {
      const body = buildOrderPayload(form, !orderId);
      const res = orderId
        ? await api.patch<DeliveryOrder>(`/deliveries/customer-orders/${orderId}/`, body)
        : await api.post<DeliveryOrder>("/deliveries/customer-orders/", body);
      setOrderId(res.data.id);
      return res.data;
    },
  });

  const send = useMutation({
    mutationFn: async (id: string) =>
      (await api.post<{ trackingNumber: string | null }>(`/deliveries/customer-orders/${id}/dispatch_order/`, {
        provider_config: accountId,
      })).data,
  });

  const remove = useMutation({
    mutationFn: async (id: string) => api.delete(`/deliveries/customer-orders/${id}/`),
  });

  const check = (mode: "draft" | "send") => {
    const found = validateOrder(form, mode);
    if (mode === "send" && !accountId) found.account = "delivery_orders.errors.account";
    setErrors(found);
    return Object.keys(found).length === 0;
  };

  const onSaveDraft = async () => {
    if (!check("draft")) return;
    try {
      await save.mutateAsync();
      invalidate();
      onDone(t("delivery_orders.saved"));
    } catch (err) {
      setProblem({ message: getApiError(err), courierMessage: "" });
    }
  };

  const onSend = async () => {
    if (!check("send")) return;
    let saved: DeliveryOrder;
    try {
      saved = await save.mutateAsync();
    } catch (err) {
      setProblem({ message: getApiError(err), courierMessage: "" });
      return;
    }
    invalidate();
    try {
      const result = await send.mutateAsync(saved.id);
      invalidate();
      onDone(t("delivery_orders.sent", { tracking: result.trackingNumber || "—" }));
    } catch (err) {
      const { courierMessage } = readDispatchProblem(err);
      setProblem({ message: getApiError(err), courierMessage });
      invalidate();
    }
  };

  const onDelete = async () => {
    if (!orderId || !window.confirm(t("delivery_orders.confirm_delete"))) return;
    try {
      await remove.mutateAsync(orderId);
      invalidate();
      onDone(t("delivery_orders.deleted"));
    } catch (err) {
      setProblem({ message: getApiError(err), courierMessage: "" });
    }
  };

  const busy = save.isPending || send.isPending || remove.isPending;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 dark:bg-black/70 backdrop-blur-sm"
         role="dialog" aria-modal="true" aria-labelledby="do-title">
      <div className="modal-dialog w-full max-w-4xl max-h-[90vh] flex flex-col">
        <div className="modal-header flex items-center justify-between">
          <h2 id="do-title" className="text-lg font-bold text-text-primary">
            {orderId ? t("delivery_orders.edit_title") : t("delivery_orders.new_title")}
          </h2>
          <button type="button" onClick={onClose} aria-label={t("common.close")}
                  className="p-1.5 rounded text-text-muted hover:bg-bg-alt dark:text-slate-400 dark:hover:bg-slate-800 focus-visible:ring-2">
            <X size={18} aria-hidden />
          </button>
        </div>

        <div className="modal-body overflow-y-auto grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-6">
            <OrderCustomerFields form={form} errors={errors} onChange={change} />
            <OrderDestinationFields form={form} errors={errors} onChange={change} accountId={accountId}
                                    communes={communes.data} communesLoading={communes.isLoading} />
          </div>
          <div className="space-y-6">
            <OrderLinesEditor lines={form.lines} errors={errors} onChange={(lines) => change({ lines })} />
            <OrderAmounts form={form} errors={errors} onChange={change} quote={quote.data}
                          quoteLoading={quote.isFetching && !quote.data} quoteFailed={quote.isError} />
          </div>
        </div>

        <div className="border-t border-border dark:border-slate-800 px-5 py-3 space-y-3">
          {problem && (
            <div className="flex gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-rose-300" role="alert">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />
              <div>
                <p>{problem.message}</p>
                {problem.courierMessage && (
                  <p className="mt-1 text-xs">{t("delivery_orders.courier_said", { message: problem.courierMessage })}</p>
                )}
              </div>
            </div>
          )}
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              {orderId && (
                <button type="button" className="btn-danger inline-flex items-center gap-1.5 focus-visible:ring-2"
                        onClick={onDelete} disabled={busy}>
                  <Trash2 size={15} aria-hidden /> {t("delivery_orders.delete")}
                </button>
              )}
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <label className="form-label" htmlFor="do-account">{t("delivery_orders.field.account")}</label>
                <select id="do-account" className="form-input" value={accountId}
                        onChange={(e) => setAccountId(e.target.value)}>
                  {accounts.length === 0 && <option value="">{t("delivery_orders.no_account")}</option>}
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.courier_name}</option>)}
                </select>
                {errors.account && <p className="mt-1 text-xs text-red-600 dark:text-rose-400" role="alert">{t(errors.account)}</p>}
              </div>
              <button type="button" className="btn-secondary inline-flex items-center gap-1.5 focus-visible:ring-2"
                      onClick={onSaveDraft} disabled={busy}>
                <Save size={15} aria-hidden /> {t("delivery_orders.save_draft")}
              </button>
              <button type="button" className="btn-primary inline-flex items-center gap-1.5 focus-visible:ring-2"
                      onClick={onSend} disabled={busy || accounts.length === 0}>
                <Truck size={15} aria-hidden /> {send.isPending ? t("delivery_orders.sending") : t("delivery_orders.send")}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
