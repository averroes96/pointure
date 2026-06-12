/**
 * useSSE — Server-Sent Events hook for the real-time dashboard.
 *
 * Enterprise plan only. Connects to GET /api/v1/events/stream/?token=<jwt>
 * and delivers typed events to the caller. Reconnects automatically on
 * network errors using the browser's built-in EventSource retry logic.
 */
import { useEffect, useRef, useState, useCallback } from "react";

const BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";
const SSE_URL = `${BASE_URL}/api/v1/events/stream/`;

export interface SaleCreatedEvent {
  sale_id: number;
  total_amount: string;
  branch_id: number | null;
  branch_name: string;
  receipt_number: string;
}

export interface StockAlertEvent {
  variant_id: number;
  product_name: string;
  size_eu: number;
  colour: string;
  stock_qty: number;
  branch_id: number | null;
  branch_name: string;
  is_out_of_stock: boolean;
}

export type SSEStatus = "connecting" | "connected" | "error" | "plan_required" | "closed";

export interface UseSSEReturn {
  status: SSEStatus;
  lastSale: (SaleCreatedEvent & { ts: number }) | null;
  stockAlerts: (StockAlertEvent & { ts: number })[];
  totalSalesDelta: number;     // cumulative revenue added since page load
  saleCountDelta: number;      // number of new sales since page load
  clearAlerts: () => void;
}

export function useSSE(enabled: boolean): UseSSEReturn {
  const esRef = useRef<EventSource | null>(null);
  const [status, setStatus] = useState<SSEStatus>("closed");
  const [lastSale, setLastSale] = useState<(SaleCreatedEvent & { ts: number }) | null>(null);
  const [stockAlerts, setStockAlerts] = useState<(StockAlertEvent & { ts: number })[]>([]);
  const [totalSalesDelta, setTotalSalesDelta] = useState(0);
  const [saleCountDelta, setSaleCountDelta] = useState(0);

  const clearAlerts = useCallback(() => setStockAlerts([]), []);

  useEffect(() => {
    if (!enabled) return;

    const token = localStorage.getItem("access_token");
    if (!token) return;

    const url = `${SSE_URL}?token=${encodeURIComponent(token)}`;
    const es = new EventSource(url);
    esRef.current = es;
    setStatus("connecting");

    es.addEventListener("connected", () => {
      setStatus("connected");
    });

    es.addEventListener("plan_required", () => {
      setStatus("plan_required");
      es.close();
    });

    es.addEventListener("sale_created", (e: MessageEvent) => {
      try {
        const data: SaleCreatedEvent = JSON.parse(e.data);
        setLastSale({ ...data, ts: Date.now() });
        setTotalSalesDelta((prev) => prev + parseFloat(data.total_amount || "0"));
        setSaleCountDelta((prev) => prev + 1);
      } catch {
        // malformed message — ignore
      }
    });

    es.addEventListener("stock_alert", (e: MessageEvent) => {
      try {
        const data: StockAlertEvent = JSON.parse(e.data);
        setStockAlerts((prev) => {
          // deduplicate by variant_id — keep only the latest per variant
          const filtered = prev.filter((a) => a.variant_id !== data.variant_id);
          return [{ ...data, ts: Date.now() }, ...filtered].slice(0, 10);
        });
      } catch {
        // ignore
      }
    });

    es.onerror = () => {
      // EventSource auto-reconnects; only mark error if it's been failing
      if (es.readyState === EventSource.CLOSED) {
        setStatus("error");
      }
    };

    return () => {
      es.close();
      esRef.current = null;
      setStatus("closed");
    };
  }, [enabled]);

  return { status, lastSale, stockAlerts, totalSalesDelta, saleCountDelta, clearAlerts };
}
