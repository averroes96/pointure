import { create } from "zustand";
import {
  getPrinterConfig,
  getLabelDimensions,
  printLabelHtml,
  type LabelsPrinterConfig,
} from "@/lib/printerConfig";

export interface LabelPrintRequest {
  title: string;
  defaultCopies?: number;
  /**
   * Fetcher or generator that returns the label HTML for given dimensions (mm) and copy count.
   */
  fetchHtml: (dims: { w: number; h: number; copies: number }) => Promise<string>;
  onSuccess?: () => void;
}

interface LabelPrintState {
  isOpen: boolean;
  request: LabelPrintRequest | null;
  htmlContent: string;
  isLoadingHtml: boolean;
  copies: number;
  openDialog: (req: LabelPrintRequest) => Promise<void>;
  closeDialog: () => void;
  setHtmlContent: (html: string) => void;
  setCopies: (copies: number) => void;
  refreshHtml: (dims: { w: number; h: number; copies: number }) => Promise<void>;
}

export const useLabelPrintStore = create<LabelPrintState>((set, get) => ({
  isOpen: false,
  request: null,
  htmlContent: "",
  isLoadingHtml: false,
  copies: 1,

  openDialog: async (req: LabelPrintRequest) => {
    const cfg = getPrinterConfig().labels;
    const { w, h } = getLabelDimensions(cfg);
    const initialCopies = Math.max(1, req.defaultCopies || 1);

    set({
      isOpen: true,
      request: req,
      copies: initialCopies,
      isLoadingHtml: true,
      htmlContent: "",
    });

    try {
      const html = await req.fetchHtml({ w, h, copies: initialCopies });
      set({ htmlContent: html, isLoadingHtml: false });
    } catch (err) {
      console.error("Failed to load label preview HTML:", err);
      set({ isLoadingHtml: false });
    }
  },

  closeDialog: () => {
    set({ isOpen: false, request: null, htmlContent: "", isLoadingHtml: false });
  },

  setHtmlContent: (html: string) => set({ htmlContent: html }),
  setCopies: (copies: number) => set({ copies: Math.max(1, copies) }),

  refreshHtml: async (dims: { w: number; h: number; copies: number }) => {
    const { request } = get();
    if (!request) return;
    set({ isLoadingHtml: true });
    try {
      const html = await request.fetchHtml(dims);
      set({ htmlContent: html, isLoadingHtml: false });
    } catch (err) {
      console.error("Failed to refresh label HTML:", err);
      set({ isLoadingHtml: false });
    }
  },
}));

/**
 * Trigger label printing.
 * If silent mode is configured, prints instantly without opening any dialog.
 * Otherwise, opens the integrated print dialog with live label preview and controls.
 */
export async function triggerLabelPrint(
  req: LabelPrintRequest,
  showToast?: (msg: string, type?: "success" | "error") => void
): Promise<void> {
  const cfg = getPrinterConfig().labels;
  const copies = Math.max(1, req.defaultCopies || 1);

  if (cfg.silent) {
    // Instant direct print mode
    const { w, h } = getLabelDimensions(cfg);
    try {
      const html = await req.fetchHtml({ w, h, copies });
      const res = await printLabelHtml(html, { copies });
      if (res.success) {
        showToast?.(
          `Étiquette(s) envoyée(s) à ${cfg.printerName || "l'imprimante par défaut"}`,
          "success"
        );
        req.onSuccess?.();
      } else {
        showToast?.(
          res.failureReason
            ? `Erreur d'impression : ${res.failureReason}`
            : "Échec de l'impression directe.",
          "error"
        );
      }
    } catch (err: any) {
      showToast?.(err?.message || "Erreur lors de la génération de l'étiquette", "error");
    }
    return;
  }

  // Interactive integrated dialog mode
  await useLabelPrintStore.getState().openDialog(req);
}
