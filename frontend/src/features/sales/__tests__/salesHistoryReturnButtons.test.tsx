import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

// A cashier could never open the return dialog: the sales history showed the Return and Exchange buttons to
// owners and managers only, although the server accepts returns from a cashier (with the permission, or a
// manager PIN) and the dialog already handles the cashier's PIN step.

const { get, auth } = vi.hoisted(() => ({
  get: vi.fn(),
  auth: { user: { role: "cashier", can_process_returns: false, tenant: { name: "Demo Store" } } as Record<string, unknown> },
}));
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, default: { get, post: vi.fn(), patch: vi.fn() } };
});
vi.mock("@/features/auth/AuthContext", () => ({ useAuth: () => ({ user: auth.user }) }));
vi.mock("@/features/auth/BranchContext", () => ({ useBranch: () => ({ currentBranch: { id: 7 } }) }));

import i18n from "@/lib/i18n";
import SalesHistoryPage from "../SalesHistoryPage";

function sale(id: number, status: string, receipt: string) {
  return {
    id, branch: 7, cashier: 3, cashier_name: "Yacine Caissier", client: null, client_name: null, loyalty_tier: null,
    loyalty_points: null, status, total_amount: "8237.00", discount_amount: "0.00", amount_paid: "8237.00",
    balance_due: "0.00", receipt_number: receipt, notes: "", is_formal: false, timbre_fiscal: "0.00", due_date: null,
    items: [], payments: [{ id: 1, method: "cash", amount: "8237.00" }], exchange_count: 0, created_at: "2026-11-20T10:00:00Z",
    is_layaway: false,
  };
}

const SALES = [sale(1, "completed", "RC-0001"), sale(2, "cancelled", "RC-0002"), sale(3, "refunded", "RC-0003")];

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter><SalesHistoryPage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Sales history: Return and Exchange buttons", () => {
  beforeEach(async () => {
    get.mockReset();
    get.mockImplementation(async (url: string) => {
      if (url.startsWith("/sales/?")) return { data: { count: SALES.length, next: null, previous: null, results: SALES } };
      if (url.startsWith("/core/users/")) return { data: { results: [] } };
      if (url.startsWith("/sales/daily-summary/")) return { data: {} };
      if (url.startsWith("/core/store-settings/")) return { data: { require_manager_pin_for_returns: true } };
      return { data: {} };
    });
    await i18n.changeLanguage("fr");
  });

  const returnTitle = () => i18n.t("sales_history.process_return_tooltip");
  const exchangeTitle = () => i18n.t("sales.process_exchange");

  it.each([
    ["cashier", false],
    ["cashier", true],
    ["manager", false],
    ["owner", false],
  ])("offers Return and Exchange on a completed sale to a %s (can_process_returns: %s)", async (role, flag) => {
    auth.user = { role, can_process_returns: flag, tenant: { name: "Demo Store" } };
    renderPage();

    await screen.findByText("RC-0001");
    expect(screen.getAllByTitle(returnTitle())).toHaveLength(1);        // the completed sale only
    expect(screen.getAllByTitle(exchangeTitle())).toHaveLength(1);
  });

  it("does not offer them on a cancelled or a refunded sale", async () => {
    auth.user = { role: "cashier", can_process_returns: true, tenant: { name: "Demo Store" } };
    renderPage();
    await screen.findByText("RC-0002");
    expect(screen.getAllByTitle(returnTitle())).toHaveLength(1);        // still only RC-0001's
  });

  it("opens the return dialog when a cashier clicks Return", async () => {
    auth.user = { role: "cashier", can_process_returns: false, tenant: { name: "Demo Store" } };
    renderPage();
    await screen.findByText("RC-0001");
    await userEvent.click(screen.getByTitle(returnTitle()));
    await waitFor(() => expect(screen.getAllByText(/RC-0001/).length).toBeGreaterThan(1));   // the dialog names the sale
  });
});
