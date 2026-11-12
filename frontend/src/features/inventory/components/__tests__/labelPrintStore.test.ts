import { beforeEach, describe, expect, it, vi } from "vitest";

const printerMocks = vi.hoisted(() => ({
  getPrinterConfig: vi.fn(),
  getLabelDimensions: vi.fn(),
  printLabelHtml: vi.fn(),
}));

vi.mock("@/lib/printerConfig", () => ({
  getPrinterConfig: printerMocks.getPrinterConfig,
  getLabelDimensions: printerMocks.getLabelDimensions,
  printLabelHtml: printerMocks.printLabelHtml,
}));

import {
  countLabelPages,
  resolvePrintCopies,
  triggerLabelPrint,
} from "../labelPrintStore";

function labelDocument(pages: number): string {
  return Array.from({ length: pages }, () => '<div class="page"></div>').join("");
}

describe("label print copy resolution", () => {
  beforeEach(() => {
    printerMocks.getPrinterConfig.mockReturnValue({
      labels: { silent: true, copies: 5 },
    });
    printerMocks.getLabelDimensions.mockReturnValue({ w: 45, h: 35 });
    printerMocks.printLabelHtml.mockResolvedValue({ success: true });
    printerMocks.printLabelHtml.mockClear();
  });

  it("uses one printer copy when the HTML already contains the requested labels", () => {
    const html = labelDocument(15);

    expect(countLabelPages(html)).toBe(15);
    expect(resolvePrintCopies(countLabelPages(html), 5)).toBe(1);
  });

  it("uses printer copies when the HTML contains one label page", () => {
    const html = labelDocument(1);

    expect(countLabelPages(html)).toBe(1);
    expect(resolvePrintCopies(countLabelPages(html), 5)).toBe(5);
  });

  it("keeps one printer copy for a multi-page label sheet requested once", () => {
    const html = labelDocument(3);

    expect(resolvePrintCopies(countLabelPages(html), 1)).toBe(1);
  });

  it("does not multiply copies when silent printing receives repeated HTML pages", async () => {
    const html = labelDocument(15);
    const fetchHtml = vi.fn().mockResolvedValue(html);

    await triggerLabelPrint({ title: "Labels", fetchHtml });

    expect(fetchHtml).toHaveBeenCalledWith({ w: 45, h: 35, copies: 5 });
    expect(printerMocks.printLabelHtml).toHaveBeenCalledWith(html, { copies: 1 });
  });

  it("retains printer copies when silent printing receives one HTML page", async () => {
    const html = labelDocument(1);

    await triggerLabelPrint({ title: "Labels", fetchHtml: vi.fn().mockResolvedValue(html) });

    expect(printerMocks.printLabelHtml).toHaveBeenCalledWith(html, { copies: 5 });
  });
});
