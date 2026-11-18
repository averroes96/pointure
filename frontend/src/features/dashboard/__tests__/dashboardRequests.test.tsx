import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, default: { get } };
});
vi.mock("@/features/auth/AuthContext", () => ({
  useAuth: () => ({ user: { role: "owner", tenant: { plan: "pro_retail" } } }),
}));
vi.mock("@/hooks/usePlan", () => ({ usePlan: () => ({ canAccess: () => false }) }));
vi.mock("@/hooks/useBusinessMode", () => ({ useBusinessMode: () => ({ showWholesaleUI: false }) }));
vi.mock("@/hooks/useSSE", () => ({
  useSSE: () => ({
    status: "closed", lastSale: null, stockAlerts: [], totalSalesDelta: 0, saleCountDelta: 0, clearAlerts: () => {},
  }),
}));
vi.mock("../GetStartedWidget", () => ({ default: () => null }));

import DashboardPage from "../DashboardPage";

const REPORT_ANSWERS: Record<string, unknown> = {
  "/reports/dashboard/": { today_revenue: "1000", total_outstanding_debt: "0", low_stock_sku_count: 0, cheques_due_this_week: 0 },
  "/reports/sales-by-period/": [],
  "/reports/best-sellers/": [],
  "/reports/seasonal-preview/": { event: "aid_el_kebir", days_until: 12, last_year_pairs: 40, last_year_top_sizes: [40, 41] },
};

describe("Dashboard report requests", () => {
  beforeEach(() => {
    get.mockReset();
    // The page reads a "hide onboarding" flag from localStorage on mount.
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {}, removeItem: () => {} });
  });

  it("runs the four reports one at a time, most important first", async () => {
    const started: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    get.mockImplementation(async (url: string) => {
      const path = url.split("?")[0];
      if (!path.startsWith("/reports/")) return { data: {} };
      started.push(path);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 15));
      inFlight -= 1;
      return { data: REPORT_ANSWERS[path] ?? {} };
    });

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter><DashboardPage /></MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(started).toHaveLength(4));
    await waitFor(() => expect(inFlight).toBe(0));
    expect(started).toEqual([
      "/reports/dashboard/", "/reports/sales-by-period/", "/reports/best-sellers/", "/reports/seasonal-preview/",
    ]);
    expect(maxInFlight).toBe(1);
    expect(await screen.findByText(/aid_el_kebir|Aïd|12/i)).toBeInTheDocument();   // the last widget still renders
  });
});
