import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@/lib/i18n";
import { PurchaseOrderImportModal } from "../components/PurchaseOrderImportModal";

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

