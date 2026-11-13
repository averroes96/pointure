import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import api, { formatDZD, getApiError } from "@/lib/api";
import { useAuth } from "@/features/auth/AuthContext";

interface ReorderLine {
  variant_id: string;
  product_id: string;
  product_name: string;
  brand: string;
  size_eu: number;
  colour: string;
  supplier_id: string | null;
  supplier_name: string;
  units_sold: number;
  stock: number;
  on_order: number;
  suggested_quantity: number;
  cartons: number;
  unit_price: string;
}

interface ReorderReport {
  cover_weeks: number;
  velocity_weeks: number;
  lines: ReorderLine[];
}

interface CreatedOrder {
  id: string;
  supplier_name: string;
  line_count: number;
}

const CATEGORIES = ["sneakers", "boots", "sandals", "formal", "sport", "kids", "slippers", "other"] as const;

export default function ReorderPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const brand = params.get("brand") || "";
  const category = params.get("category") || "";
  const supplier = params.get("supplier") || "";
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [orders, setOrders] = useState<CreatedOrder[] | null>(null);
  const [coverDraft, setCoverDraft] = useState("");

  const filters = {
    ...(brand ? { brand } : {}),
    ...(category ? { category } : {}),
    ...(supplier ? { supplier } : {}),
  };

  const { data, isLoading, isError } = useQuery<ReorderReport>({
    queryKey: ["reports", "reorder", filters],
    queryFn: () => api.get("/reports/reorder-suggestions/", { params: filters }).then((r) => r.data),
  });

  const suppliersQuery = useQuery<{ results?: { id: string; name: string }[] }>({
    queryKey: ["suppliers", "reorder-filter"],
    queryFn: () => api.get("/suppliers/?page_size=200").then((r) => r.data),
  });

  useEffect(() => {
    if (!data) return;
    const nextQty: Record<string, number> = {};
    const nextPick: Record<string, boolean> = {};
    for (const line of data.lines) {
      nextQty[line.variant_id] = line.suggested_quantity;
      nextPick[line.variant_id] = Boolean(line.supplier_id);
    }
    setQuantities(nextQty);
    setPicked(nextPick);
    setCoverDraft(String(data.cover_weeks));
    setOrders(null);
  }, [data]);

  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (!value) next.delete(key);
    else next.set(key, value);
    setParams(next);
  }

  const createOrders = useMutation({
    mutationFn: async () => {
      const lines = (data?.lines ?? [])
        .filter((line) => picked[line.variant_id])
        .map((line) => ({
          variant_id: line.variant_id,
          quantity: quantities[line.variant_id] || line.suggested_quantity,
        }));
      const response = await api.post("/reports/reorder-suggestions/create-po/", { lines });
      return response.data as { orders: CreatedOrder[] };
    },
    onSuccess: (result) => setOrders(result.orders),
  });

  const saveCover = useMutation({
    mutationFn: async () => {
      await api.patch("/core/store-settings/update_settings/", {
        reorder_cover_weeks: Number(coverDraft),
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["reports", "reorder"] }),
  });

  const selectedCount = Object.values(picked).filter(Boolean).length;

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">{t("report.reorder_title")}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t("report.reorder_subtitle")}</p>
        </div>
        {user?.role === "owner" ? (
          <form
            className="flex items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              saveCover.mutate();
            }}
          >
            <label className="block">
              <span className="form-label">{t("report.cover_weeks")}</span>
              <input
                className="form-input w-24"
                type="number"
                min={1}
                max={52}
                value={coverDraft}
                onChange={(event) => setCoverDraft(event.target.value)}
              />
            </label>
            <button type="submit" className="btn-secondary" disabled={saveCover.isPending}>
              {t("report.cover_save")}
            </button>
          </form>
        ) : (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {t("report.cover_weeks")}: {data?.cover_weeks ?? "—"}
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <label className="block">
          <span className="form-label">{t("report.brand")}</span>
          <input className="form-input" value={brand} onChange={(event) => setFilter("brand", event.target.value)} />
        </label>
        <label className="block">
          <span className="form-label">{t("report.category")}</span>
          <select className="form-input" value={category} onChange={(event) => setFilter("category", event.target.value)}>
            <option value="">{t("report.all")}</option>
            {CATEGORIES.map((value) => (
              <option key={value} value={value}>{t(`category.${value}`)}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="form-label">{t("report.supplier")}</span>
          <select className="form-input" value={supplier} onChange={(event) => setFilter("supplier", event.target.value)}>
            <option value="">{t("report.all")}</option>
            {(suppliersQuery.data?.results ?? []).map((row) => (
              <option key={row.id} value={row.id}>{row.name}</option>
            ))}
          </select>
        </label>
      </div>

      {isLoading && <p className="text-sm text-slate-500 dark:text-slate-400">{t("report.loading_report")}</p>}
      {isError && <p className="text-sm text-red-600 dark:text-red-400">{t("report.error_loading_date")}</p>}

      {orders && (
        <div className="rounded-2xl border border-teal-200 dark:border-teal-900 bg-teal-50 dark:bg-teal-950/40 p-4 text-sm text-teal-900 dark:text-teal-100">
          <p className="font-semibold">{t("report.reorder_created")}</p>
          <ul className="mt-2 space-y-1">
            {orders.map((order) => (
              <li key={order.id}>
                <Link to={`/purchase-orders/${order.id}`} className="underline">
                  {order.supplier_name} ({t("report.reorder_lines", { count: order.line_count })})
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {data && data.lines.length === 0 && (
        <p className="text-sm text-slate-500 dark:text-slate-400">{t("report.reorder_empty")}</p>
      )}

      {data && data.lines.length > 0 && (
        <>
          <div className="overflow-x-auto bg-white dark:bg-slate-900/90 rounded-2xl border border-slate-200/80 dark:border-slate-800">
            <table className="min-w-full text-sm">
              <thead className="text-left text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="px-3 py-3" />
                  <th className="px-3 py-3 font-medium">{t("report.item")}</th>
                  <th className="px-3 py-3 font-medium">{t("report.supplier")}</th>
                  <th className="px-3 py-3 font-medium">{t("report.units_sold")}</th>
                  <th className="px-3 py-3 font-medium">{t("report.stock")}</th>
                  <th className="px-3 py-3 font-medium">{t("report.on_order")}</th>
                  <th className="px-3 py-3 font-medium">{t("report.reorder_qty")}</th>
                  <th className="px-3 py-3 font-medium">{t("report.amount")}</th>
                </tr>
              </thead>
              <tbody className="text-slate-900 dark:text-slate-100">
                {data.lines.map((line) => (
                  <tr key={line.variant_id} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={Boolean(picked[line.variant_id])}
                        disabled={!line.supplier_id}
                        onChange={(event) => setPicked((current) => ({
                          ...current,
                          [line.variant_id]: event.target.checked,
                        }))}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <Link to={`/inventory/products/${line.product_id}`} className="hover:underline">
                        {line.brand ? `${line.brand} ` : ""}{line.product_name}
                      </Link>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        {t("report.size")} {line.size_eu}
                        {line.colour && line.colour !== "Standard" ? ` · ${line.colour}` : ""}
                        {line.cartons > 0 ? ` · ${t("report.reorder_cartons", { count: line.cartons })}` : ""}
                      </div>
                      {!line.supplier_id && (
                        <div className="text-xs text-amber-700 dark:text-amber-300">{t("report.reorder_no_supplier")}</div>
                      )}
                    </td>
                    <td className="px-3 py-2">{line.supplier_name || "—"}</td>
                    <td className="px-3 py-2 font-mono">{line.units_sold}</td>
                    <td className="px-3 py-2 font-mono">{line.stock}</td>
                    <td className="px-3 py-2 font-mono">{line.on_order}</td>
                    <td className="px-3 py-2">
                      <input
                        className="form-input w-20"
                        type="number"
                        min={1}
                        value={quantities[line.variant_id] ?? line.suggested_quantity}
                        onChange={(event) => setQuantities((current) => ({
                          ...current,
                          [line.variant_id]: Math.max(1, Number(event.target.value) || 1),
                        }))}
                      />
                    </td>
                    <td className="px-3 py-2 font-mono">
                      {formatDZD(Number(line.unit_price) * (quantities[line.variant_id] ?? line.suggested_quantity))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {createOrders.isError && (
            <p className="text-sm text-red-600 dark:text-red-400">{getApiError(createOrders.error)}</p>
          )}
          <button
            type="button"
            className="btn-primary"
            disabled={selectedCount === 0 || createOrders.isPending}
            onClick={() => createOrders.mutate()}
          >
            {t("report.reorder_create")}
          </button>
        </>
      )}
    </div>
  );
}
