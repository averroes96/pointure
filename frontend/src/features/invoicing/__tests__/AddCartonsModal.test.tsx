import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AxiosHeaders, type AxiosResponse } from "axios";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@/lib/i18n";
import api from "@/lib/api";
import { AddCartonsModal } from "../components/AddCartonsModal";

vi.mock("@/lib/api", () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
  getApiError: vi.fn(() => "Request failed"),
}));

function axiosResponse<T>(data: T): AxiosResponse<T> {
  const headers = new AxiosHeaders();
  return {
    data,
    status: 200,
    statusText: "OK",
    headers,
    config: { headers },
  };
}

describe("AddCartonsModal branch stock lookup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends the invoice branch when requesting carton stock", async () => {
    vi.mocked(api.get).mockResolvedValue(
      axiosResponse({
        results: [
          {
            id: 42,
            name: "Mocassin Cuir",
            brand: "Demo",
            sale_price: "5000.00",
            wholesale_price: "4000.00",
            pairs_per_carton: 2,
            carton_breakdown: { "40": 2 },
            variants: [{ id: 7, size_eu: 40, colour: "Noir", stock_qty: 0 }],
          },
        ],
      })
    );
    vi.mocked(api.post).mockResolvedValue(
      axiosResponse({
        total_pairs: 2,
        all_stock_sufficient: true,
        lines: [{ size_eu: 40, quantity: 2, available_stock: 2, is_sufficient_stock: true }],
      })
    );

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <AddCartonsModal
          isOpen
          onClose={vi.fn()}
          branchId="branch-uuid"
          onAddCartons={vi.fn()}
        />
      </QueryClientProvider>
    );

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Mocassin" } });
    fireEvent.click(await screen.findByRole("button", { name: /Mocassin Cuir/ }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(
        "/inventory/products/42/expand-cartons/",
        { colour: "Noir", cartons: 1, tier: "gros", branch_id: "branch-uuid" }
      );
    });
  });
});
