import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import api, { formatDZD, getApiError } from "@/lib/api";

interface PreviewRow {
  line_id: string;
  description: string;
  quantity: number;
  supplier_unit_price: string;
  dzd_unit_price: string;
  allocated_cost: string;
  landed_unit_cost: string;
  estimated_pamp: string | null;
}

interface CostLine {
  label: string;
  amount_dzd: string;
}

interface LandedCostState {
  status: "draft" | "applied";
  currency: string;
  exchange_rate: string;
  allocation: "value" | "pairs" | "cartons";
  cost_lines: CostLine[];
  total_costs: string;
  can_apply: boolean;
  preview: PreviewRow[];
}

const ALLOCATIONS = ["value", "pairs", "cartons"] as const;

export default function LandedCostPanel({ poId }: { poId: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery<LandedCostState>({
    queryKey: ["landed-cost", poId],
    queryFn: () => api.get(`/suppliers/purchase-orders/${poId}/landed-cost/`).then((response) => response.data),
  });

  const [currency, setCurrency] = useState("DZD");
  const [rate, setRate] = useState("1.0000");
  const [allocation, setAllocation] = useState<LandedCostState["allocation"]>("value");
  const [lines, setLines] = useState<CostLine[]>([]);

  useEffect(() => {
    if (!data) return;
    setCurrency(data.currency);
    setRate(data.exchange_rate);
    setAllocation(data.allocation);
    setLines(data.cost_lines);
  }, [data]);

  const payload = {
    currency,
    exchange_rate: rate,
    allocation,
    lines: lines.map((line) => ({ label: line.label, amount_dzd: line.amount_dzd || "0" })),
  };

  const save = useMutation({
    mutationFn: async () => {
      const response = await api.put(`/suppliers/purchase-orders/${poId}/landed-cost/`, payload);
      return response.data as LandedCostState;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["landed-cost", poId] });
      queryClient.invalidateQueries({ queryKey: ["purchase-order", poId] });
    },
  });

  const apply = useMutation({
    mutationFn: async () => {
      await api.put(`/suppliers/purchase-orders/${poId}/landed-cost/`, payload);
      const response = await api.post(`/suppliers/purchase-orders/${poId}/landed-cost/apply/`);
      return response.data as LandedCostState;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["landed-cost", poId] });
      queryClient.invalidateQueries({ queryKey: ["purchase-order", poId] });
    },
  });

  const locked = data?.status === "applied" || data?.can_apply === false;
  const error = save.error || apply.error;

  return (
    <section className="card p-4 space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">{t("landed.title")}</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{t("landed.help")}</p>
      </div>
      {isLoading && <p className="text-sm text-slate-500 dark:text-slate-400">{t("common.loading")}</p>}
      {data && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="block">
              <span className="form-label">{t("landed.currency")}</span>
              <input className="form-input" maxLength={3} value={currency} disabled={locked} onChange={(event) => setCurrency(event.target.value.toUpperCase())} />
            </label>
            <label className="block">
              <span className="form-label">{t("landed.rate")}</span>
              <input className="form-input" type="number" min="0.0001" step="0.0001" value={rate} disabled={locked} onChange={(event) => setRate(event.target.value)} />
            </label>
            <label className="block">
              <span className="form-label">{t("landed.allocation")}</span>
              <select className="form-input" value={allocation} disabled={locked} onChange={(event) => setAllocation(event.target.value as LandedCostState["allocation"])}>
                {ALLOCATIONS.map((value) => (
                  <option key={value} value={value}>{t(`landed.allocation_${value}`)}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="space-y-2">
            {lines.map((line, index) => (
              <div key={`${line.label}-${index}`} className="grid grid-cols-2 gap-2">
                <input
                  className="form-input"
                  value={line.label}
                  disabled={locked}
                  onChange={(event) => setLines((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, label: event.target.value } : row))}
                />
                <input
                  className="form-input"
                  type="number"
                  min="0"
                  step="0.01"
                  value={line.amount_dzd}
                  disabled={locked}
                  onChange={(event) => setLines((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, amount_dzd: event.target.value } : row))}
                />
              </div>
            ))}
          </div>
          {data.preview.length > 0 && (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm text-slate-900 dark:text-slate-100">
                <thead className="text-left text-slate-500 dark:text-slate-400">
                  <tr>
                    <th className="py-2 pr-3 font-medium">{t("landed.line")}</th>
                    <th className="py-2 pr-3 font-medium">{t("landed.supplier_price")}</th>
                    <th className="py-2 pr-3 font-medium">{t("landed.dzd_price")}</th>
                    <th className="py-2 pr-3 font-medium">{t("landed.allocated")}</th>
                    <th className="py-2 pr-3 font-medium">{t("landed.unit_cost")}</th>
                    <th className="py-2 font-medium">{t("landed.pamp")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.preview.map((row) => (
                    <tr key={row.line_id} className="border-t border-slate-100 dark:border-slate-800">
                      <td className="py-2 pr-3">{row.description}</td>
                      <td className="py-2 pr-3 font-mono">{formatDZD(row.supplier_unit_price)} {data.currency}</td>
                      <td className="py-2 pr-3 font-mono">{formatDZD(row.dzd_unit_price)}</td>
                      <td className="py-2 pr-3 font-mono">{formatDZD(row.allocated_cost)}</td>
                      <td className="py-2 pr-3 font-mono">{formatDZD(row.landed_unit_cost)}</td>
                      <td className="py-2 font-mono">{row.estimated_pamp ? formatDZD(row.estimated_pamp) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {error && <p className="text-sm text-red-600 dark:text-red-400">{getApiError(error)}</p>}
          {!locked && (
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-secondary" disabled={save.isPending} onClick={() => save.mutate()}>
                {t("landed.preview")}
              </button>
              <button type="button" className="btn-primary" disabled={apply.isPending} onClick={() => apply.mutate()}>
                {t("landed.apply")}
              </button>
            </div>
          )}
          {data.status === "applied" && (
            <p className="text-sm text-teal-800 dark:text-teal-300">{t("landed.applied")}</p>
          )}
          {data.status !== "applied" && !data.can_apply && (
            <p className="text-sm text-amber-700 dark:text-amber-300">{t("landed.already_received")}</p>
          )}
        </>
      )}
    </section>
  );
}
