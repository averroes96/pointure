import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@/lib/i18n";
import {
  DocumentScanReviewModal,
  type ScanColumnDefinition,
  type ScanRowBase,
} from "@/components/scanner/DocumentScanReviewModal";
import { ImagePOImportModal } from "../components/ImagePOImportModal";

const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

interface DummyScanRow extends ScanRowBase {
  ref: string;
  qty: number;
  price: number;
}

describe("DocumentScanReviewModal (Agnostic)", () => {
  const dummyColumns: ScanColumnDefinition<DummyScanRow>[] = [
    { key: "ref", label: "Référence", width: "120px" },
    { key: "qty", label: "Quantité", type: "number", align: "right", subtotalType: "sum" },
    { key: "price", label: "Prix Unitaire", type: "number", align: "right" },
  ];

  it("renders split-screen modal when isOpen=true", () => {
    const handleRowsChange = vi.fn();
    render(
      <DocumentScanReviewModal<DummyScanRow>
        isOpen={true}
        onClose={vi.fn()}
        title="Test Document Scanner"
        subtitle="Test OCR scanner subtitle"
        imageUrl="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
        imageWidth={800}
        imageHeight={600}
        tokens={[
          { text: "TestToken", bbox: [50, 50, 150, 80], confidence: 0.99 },
        ]}
        columns={dummyColumns}
        rows={[
          { row_index: 1, ref: "ART-01", qty: 20, price: 1500, bbox: [50, 50, 200, 80] },
          { row_index: 2, ref: "ART-02", qty: 30, price: 2500, bbox: [50, 100, 200, 130] },
        ]}
        onRowsChange={handleRowsChange}
        createEmptyRow={() => ({ row_index: 3, ref: "", qty: 1, price: 0 })}
        primaryActionLabel="Enregistrer le document"
        onPrimaryAction={vi.fn()}
      />
    );

    expect(screen.getByText("Test Document Scanner")).toBeInTheDocument();
    expect(screen.getByText("Test OCR scanner subtitle")).toBeInTheDocument();
    expect(screen.getByTestId("scanner-svg-overlay")).toBeInTheDocument();
    expect(screen.getByDisplayValue("ART-01")).toBeInTheDocument();
    expect(screen.getByDisplayValue("ART-02")).toBeInTheDocument();
    // Subtotal sum for qty (20 + 30 = 50)
    expect(screen.getByText("50")).toBeInTheDocument();
  });

  it("allows adding and deleting rows in the review table", () => {
    const handleRowsChange = vi.fn();
    render(
      <DocumentScanReviewModal<DummyScanRow>
        isOpen={true}
        onClose={vi.fn()}
        title="Agnostic Modal"
        imageUrl={null}
        columns={dummyColumns}
        rows={[{ row_index: 1, ref: "ART-01", qty: 10, price: 1200 }]}
        onRowsChange={handleRowsChange}
        createEmptyRow={() => ({ row_index: 2, ref: "NEW-ART", qty: 1, price: 0 })}
        primaryActionLabel="Valider"
        onPrimaryAction={vi.fn()}
      />
    );

    // Click Add row
    const addBtn = screen.getByTestId("scanner-add-row-btn");
    fireEvent.click(addBtn);
    expect(handleRowsChange).toHaveBeenCalledWith([
      { row_index: 1, ref: "ART-01", qty: 10, price: 1200 },
      { row_index: 2, ref: "NEW-ART", qty: 1, price: 0 },
    ]);

    // Click Delete row
    const deleteBtn = screen.getByTestId("scanner-delete-row-0");
    fireEvent.click(deleteBtn);
    expect(handleRowsChange).toHaveBeenCalledWith([]);
  });

  it("does not render when isOpen=false", () => {
    const { container } = render(
      <DocumentScanReviewModal<DummyScanRow>
        isOpen={false}
        onClose={vi.fn()}
        title="Hidden Modal"
        imageUrl={null}
        columns={dummyColumns}
        rows={[]}
        onRowsChange={vi.fn()}
        createEmptyRow={() => ({ ref: "", qty: 0, price: 0 })}
        primaryActionLabel="Save"
        onPrimaryAction={vi.fn()}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe("ImagePOImportModal (PO Wrapper)", () => {
  it("renders when isOpen=true with supplier selection and photo scanner controls", () => {
    const queryClient = createTestQueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <ImagePOImportModal
          isOpen={true}
          onClose={vi.fn()}
          preselectedSupplierId="123"
        />
      </QueryClientProvider>
    );

    expect(screen.getByText(/Scanner un bon fournisseur|Scan Supplier Slip/i)).toBeInTheDocument();
    expect(screen.getByText(/Générer le bon de commande|Generate purchase order/i)).toBeInTheDocument();
  });

  it("calls onClose when cancel is clicked", () => {
    const queryClient = createTestQueryClient();
    const handleClose = vi.fn();
    render(
      <QueryClientProvider client={queryClient}>
        <ImagePOImportModal
          isOpen={true}
          onClose={handleClose}
        />
      </QueryClientProvider>
    );

    const cancelBtn = screen.getByText(/Annuler|Cancel/i);
    fireEvent.click(cancelBtn);
    expect(handleClose).toHaveBeenCalled();
  });
});

