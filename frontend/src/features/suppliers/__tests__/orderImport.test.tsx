import { beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AxiosHeaders, type AxiosResponse } from "axios";
import i18n from "@/lib/i18n";
import api from "@/lib/api";
import type { POImportPreviewResponse } from "@/types";
import { PurchaseOrderImportModal } from "../components/PurchaseOrderImportModal";

vi.mock("@/lib/api", () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
  formatDZD: (value: string | number | null | undefined) => String(value ?? "0"),
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

const warningPreview: POImportPreviewResponse = {
  detected_encoding: "utf-8",
  detected_delimiter: ";",
  header_row: 1,
  headers: ["Reference", "Size", "Quantity", "Price"],
  auto_mapping: {},
  column_map: { Reference: "reference" },
  size_mode: "single",
  size_matrix_columns: {},
  default_colour: "",
  default_pairs_per_carton: null,
  templates: [],
  applied_template_id: null,
  raw_rows: [],
  total_raw_rows: 1,
  preview_lines: [{
    row_index: 2,
    reference: "SKU-1",
    description: "Shoe",
    size_eu: null,
    size_raw: "38.5",
    size_warning: true,
    colour: "Standard",
    brand: "",
    location: "",
    quantity: null,
    quantity_raw: "2.5",
    qty_warning: true,
    cartons: 0,
    pairs_per_carton: 10,
    unit_price: "0.00",
    unit_price_raw: "N/A",
    price_warning: true,
    match_status: "new_product",
    product_id: null,
    product_name: null,
    variant_id: null,
  }],
  summary: {
    total_lines: 1,
    total_cartons: 0,
    total_pairs: 0,
    total_estimated_amount: "0.00",
    matched_count: 0,
    missing_variants_count: 0,
    new_products_count: 1,
    qty_warnings_count: 1,
    size_warnings_count: 1,
    price_warnings_count: 1,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.get).mockResolvedValue(axiosResponse({ results: [] }));
});

const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

describe("PurchaseOrderImportModal", () => {
  it("renders upload step when opened", () => {
    const queryClient = createTestQueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <PurchaseOrderImportModal
          isOpen={true}
          onClose={vi.fn()}
          preselectedSupplierId="1"
        />
      </QueryClientProvider>
    );

    // Modal title & file dropzone are present
    expect(screen.getByText(/Smart Purchase Order Import|Import intelligent de bon de commande/i)).toBeInTheDocument();
    expect(screen.getByText(/Drag & drop a file here|Glissez-déposez un fichier/i)).toBeInTheDocument();
  });

  it("does not render when isOpen is false", () => {
    const queryClient = createTestQueryClient();
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <PurchaseOrderImportModal
          isOpen={false}
          onClose={vi.fn()}
        />
      </QueryClientProvider>
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("rejects unsupported legacy .xls files", async () => {
    await i18n.changeLanguage("fr");
    const queryClient = createTestQueryClient();
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <PurchaseOrderImportModal isOpen={true} onClose={vi.fn()} />
      </QueryClientProvider>
    );
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;

    expect(fileInput.accept.split(",").map((extension) => extension.trim())).toEqual([".csv", ".xlsx"]);
    fireEvent.change(fileInput, {
      target: { files: [new File(["legacy workbook"], "legacy.xls")] },
    });

    expect(screen.getByText("Veuillez choisir un fichier .xlsx ou .csv.")).toBeInTheDocument();
  });

  it("shows invalid import values and disables confirmation", async () => {
    await i18n.changeLanguage("en");
    vi.clearAllMocks();
    vi.mocked(api.get).mockResolvedValue(axiosResponse({ results: [] }));
    vi.mocked(api.post)
      .mockResolvedValueOnce(axiosResponse(warningPreview))
      .mockResolvedValueOnce(axiosResponse(warningPreview));

    const queryClient = createTestQueryClient();
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <PurchaseOrderImportModal
          isOpen={true}
          onClose={vi.fn()}
          preselectedSupplierId="supplier-1"
        />
      </QueryClientProvider>
    );

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, {
      target: { files: [new File(["csv"], "order.csv", { type: "text/csv" })] },
    });
    fireEvent.click(screen.getByRole("button", { name: /Analyze & Configure/i }));
    const previewBtn = await screen.findByRole("button", { name: /Confirm columns and preview/i });
    fireEvent.click(previewBtn);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Correct the flagged quantities, sizes, or prices in the source file"
    );
    expect(screen.getByText("Unreadable quantity: 2.5")).toBeInTheDocument();
    expect(screen.getByText("Unreadable size")).toBeInTheDocument();
    expect(screen.getByText("Unreadable price: N/A")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Create Purchase Order/ })).toBeDisabled();
    expect(api.post).toHaveBeenCalledTimes(2);
  });

  it("calls onClose when cancel or close button is clicked", () => {
    const queryClient = createTestQueryClient();
    const onCloseMock = vi.fn();
    render(
      <QueryClientProvider client={queryClient}>
        <PurchaseOrderImportModal
          isOpen={true}
          onClose={onCloseMock}
        />
      </QueryClientProvider>
    );

    const cancelBtn = screen.getByText(/Cancel|Annuler/i);
    fireEvent.click(cancelBtn);
    expect(onCloseMock).toHaveBeenCalled();
  });

  it("safely transitions from isOpen: false to isOpen: true without hook order violations", () => {
    const queryClient = createTestQueryClient();
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <PurchaseOrderImportModal
          isOpen={false}
          onClose={vi.fn()}
        />
      </QueryClientProvider>
    );

    // Rerender with isOpen = true
    rerender(
      <QueryClientProvider client={queryClient}>
        <PurchaseOrderImportModal
          isOpen={true}
          onClose={vi.fn()}
        />
      </QueryClientProvider>
    );

    expect(screen.getByText(/Smart Purchase Order Import|Import intelligent de bon de commande/i)).toBeInTheDocument();
  });
});

