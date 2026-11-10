import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act, cleanup } from "@testing-library/react";
import "@/lib/i18n";
import LabelPrintDialog from "../LabelPrintDialog";
import { useLabelPrintStore, triggerLabelPrint } from "../labelPrintStore";
import * as printerConfig from "@/lib/printerConfig";

vi.mock("@/lib/printerConfig", async () => {
  const actual = await vi.importActual<typeof import("@/lib/printerConfig")>("@/lib/printerConfig");
  return {
    ...actual,
    printLabelHtml: vi.fn().mockResolvedValue({ success: true }),
    savePrinterConfig: vi.fn(),
    getPrinterConfig: vi.fn().mockReturnValue({
      labels: {
        printerName: "Zebra-GK420d",
        labelSize: "45x35",
        customWidth: 45,
        customHeight: 35,
        offsetX: 0,
        offsetY: 0,
        landscape: false,
        silent: false,
        copies: 1,
      },
      ticket: {},
      invoice: {},
    }),
  };
});

describe("LabelPrintDialog - Copy multiplication prevention (P1-4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    act(() => {
      useLabelPrintStore.getState().closeDialog();
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("passes copies: 1 to printLabelHtml when HTML already contains duplicated pages", async () => {
    const printLabelHtmlSpy = vi.spyOn(printerConfig, "printLabelHtml");

    // 5 pages HTML returned by server for copies = 5
    const multiPageHtml = `
      <html>
        <body>
          <div class="page">Label 1</div>
          <div class="page">Label 2</div>
          <div class="page">Label 3</div>
          <div class="page">Label 4</div>
          <div class="page">Label 5</div>
        </body>
      </html>
    `;

    render(<LabelPrintDialog />);

    await act(async () => {
      await useLabelPrintStore.getState().openDialog({
        title: "Test Labels",
        defaultCopies: 5,
        fetchHtml: vi.fn().mockResolvedValue(multiPageHtml),
      });
    });

    const printButton = await screen.findByRole("button", { name: /^(imprimer|print)$/i });
    expect(printButton).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(printButton);
    });

    await waitFor(() => {
      expect(printLabelHtmlSpy).toHaveBeenCalledTimes(1);
    });

    // CRITICAL: Must be copies: 1, NOT 5 (which would square copies to 25)
    expect(printLabelHtmlSpy).toHaveBeenCalledWith(
      multiPageHtml,
      expect.objectContaining({
        copies: 1,
      })
    );

    // Wait for the 600ms feedback timeout before next test
    await act(async () => {
      await new Promise((r) => setTimeout(r, 700));
    });
  });

  it("passes copies: 5 to printLabelHtml when HTML only contains 1 single page", async () => {
    const printLabelHtmlSpy = vi.spyOn(printerConfig, "printLabelHtml");

    // Server only returned 1 page despite copies: 5 requested
    const singlePageHtml = `
      <html>
        <body>
          <div class="page">Single Label</div>
        </body>
      </html>
    `;

    render(<LabelPrintDialog />);

    await act(async () => {
      await useLabelPrintStore.getState().openDialog({
        title: "Test Single Label",
        defaultCopies: 5,
        fetchHtml: vi.fn().mockResolvedValue(singlePageHtml),
      });
    });

    const printButton = await screen.findByRole("button", { name: /^(imprimer|print)$/i });
    expect(printButton).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(printButton);
    });

    await waitFor(() => {
      expect(printLabelHtmlSpy).toHaveBeenCalledTimes(1);
    });

    // Single page HTML must be repeated by printer driver
    expect(printLabelHtmlSpy).toHaveBeenCalledWith(
      singlePageHtml,
      expect.objectContaining({
        copies: 5,
      })
    );

    // Wait for the 600ms feedback timeout before next test
    await act(async () => {
      await new Promise((r) => setTimeout(r, 700));
    });
  });

  it("passes copies: 1 in silent mode when HTML already contains duplicated pages", async () => {
    const printLabelHtmlSpy = vi.spyOn(printerConfig, "printLabelHtml");
    vi.spyOn(printerConfig, "getPrinterConfig").mockReturnValue({
      labels: {
        printerName: "Zebra-GK420d",
        labelSize: "45x35",
        customWidth: 45,
        customHeight: 35,
        offsetX: 0,
        offsetY: 0,
        landscape: false,
        silent: true, // Silent instant print
        copies: 1,
      },
      ticket: {} as any,
      invoice: {} as any,
    });

    const multiPageHtml = `
      <html>
        <body>
          <div class="page">Label 1</div>
          <div class="page">Label 2</div>
          <div class="page">Label 3</div>
        </body>
      </html>
    `;

    await act(async () => {
      await triggerLabelPrint({
        title: "Silent Test",
        defaultCopies: 3,
        fetchHtml: vi.fn().mockResolvedValue(multiPageHtml),
      });
    });

    expect(printLabelHtmlSpy).toHaveBeenCalledTimes(1);
    expect(printLabelHtmlSpy).toHaveBeenCalledWith(
      multiPageHtml,
      expect.objectContaining({
        copies: 1,
      })
    );
  });
});
