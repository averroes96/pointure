import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { AxiosHeaders, type AxiosResponse } from "axios";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import "@/lib/i18n";
import api from "@/lib/api";
import QuoteFormPage from "../QuoteFormPage";

vi.mock("@/lib/api", () => ({
  default: {
    get: vi.fn(),
    put: vi.fn(),
    post: vi.fn(),
  },
  formatDZD: (value: number | string) => String(value),
  getApiError: () => "Request failed",
}));

vi.mock("@/features/auth/BranchContext", () => ({
  useBranch: () => ({ currentBranch: null }),
}));

vi.mock("@/hooks/useBusinessMode", () => ({
  useBusinessMode: () => ({ settings: { tax_regime: "reel" } }),
}));

vi.mock("../components/ClientSelector", () => ({
  ClientSelector: () => null,
}));

vi.mock("../components/InvoiceProductMatrix", () => ({
  InvoiceProductMatrix: () => null,
  createEmptyMatrix: () => ({
    id: "empty-matrix",
    product: null,
    cartons: 1,
    pairs_per_carton: 10,
    unit_price: "",
    discount_pct: "0",
    quantities: {},
  }),
}));

vi.mock("../components/AddCartonsModal", () => ({
  AddCartonsModal: () => null,
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

describe("QuoteFormPage editing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("preserves free-text and unmatched variant lines when saving an edit", async () => {
    const quote = {
      id: "quote-1",
      client: null,
      client_name: "",
      branch: null,
      number: "DV-2026-0001",
      date: "2026-11-11",
      valid_until: "2026-11-26",
      status: "draft",
      total_ht: "5100.00",
      tva_rate: "19.00",
      tva_amount: "969.00",
      total_ttc: "6069.00",
      apply_tva: true,
      notes: "",
      converted_invoice: null,
      converted_invoice_number: "",
      converted_delivery_note: null,
      converted_delivery_note_number: "",
      has_pdf: false,
      created_at: "2026-11-11T10:00:00Z",
      updated_at: "2026-11-11T10:00:00Z",
      lines: [
        {
          id: "line-free-text",
          variant: null,
          product_id: null,
          description: "Installation et livraison",
          quantity: "1.00",
          unit_price: "100.00",
          discount_pct: "0.00",
          cartons: 0,
          line_total: "100.00",
          order: 0,
        },
        {
          id: "line-matrix",
          variant: 41,
          product_id: "product-1",
          product_name: "Mocassin",
          colour: "Noir",
          size_eu: "40",
          description: "Mocassin EU40 Noir",
          quantity: "2.00",
          unit_price: "2500.00",
          discount_pct: "0.00",
          cartons: 0,
          line_total: "5000.00",
          order: 1,
        },
        {
          id: "line-unmatched-variant",
          variant: 42,
          product_id: "product-1",
          product_name: "Mocassin",
          colour: "Noir",
          size_eu: "41",
          description: "Mocassin EU41 Noir",
          quantity: "1.00",
          unit_price: "2500.00",
          discount_pct: "0.00",
          cartons: 0,
          line_total: "2500.00",
          order: 2,
        },
      ],
    };

    vi.mocked(api.get)
      .mockResolvedValueOnce(axiosResponse(quote))
      .mockResolvedValueOnce(
        axiosResponse({
          id: "product-1",
          name: "Mocassin",
          brand: "",
          sale_price: "3000.00",
          variants: [{ id: 41, size_eu: 40, colour: "Noir", stock_qty: 0 }],
        })
      );
    vi.mocked(api.put).mockResolvedValue(axiosResponse({}));

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/quotes/quote-1/edit"]}>
          <Routes>
            <Route path="/quotes/:id/edit" element={<QuoteFormPage />} />
            <Route path="/quotes" element={<div />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );

    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
    fireEvent.submit(container.querySelector("form")!);

    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    const payload = vi.mocked(api.put).mock.calls[0][1] as {
      lines: Array<{
        description: string;
        variant: number | string | null;
        quantity: string;
        unit_price: string;
      }>;
    };

    expect(payload.lines).toHaveLength(3);
    expect(payload.lines).toContainEqual({
      description: "Installation et livraison",
      variant: null,
      quantity: "1.00",
      unit_price: "100.00",
      discount_pct: "0.00",
      cartons: 0,
    });
    expect(payload.lines).toContainEqual({
      description: "Mocassin EU41 Noir",
      variant: 42,
      quantity: "1.00",
      unit_price: "2500.00",
      discount_pct: "0.00",
      cartons: 0,
    });
    expect(payload.lines).toContainEqual({
      description: "Mocassin EU40 Noir",
      variant: 41,
      quantity: "2",
      unit_price: "2500.00",
      discount_pct: "0.00",
      cartons: 0,
    });
  });
});
