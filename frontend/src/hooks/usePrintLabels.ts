/**
 * usePrintLabels — shared hook for printing barcode label PDFs.
 *
 * Calls GET /inventory/variants/{id}/barcode-label/?copies=N,
 * wraps the response in a blob URL, and opens it in a new tab.
 * The backend PDF has N identical pages (one per item received).
 *
 * Usage:
 *   const { printLabels, isPrinting } = usePrintLabels();
 *   printLabels(variantId, copies);
 */
import { useState, useCallback } from "react";
import api from "@/lib/api";
import { viewPdfDocument } from "@/lib/pdfViewer";

export function usePrintLabels() {
  const [isPrinting, setIsPrinting] = useState(false);

  const printLabels = useCallback(
    async (variantId: number | string, copies = 1) => {
      if (isPrinting) return;
      setIsPrinting(true);
      try {
        const n = Math.max(1, Math.min(Math.round(Number(copies)), 200));
        const res = await api.get(
          `/inventory/variants/${variantId}/barcode-label/?copies=${n}`,
          { responseType: "arraybuffer" }
        );
        await viewPdfDocument(res.data, {
          title: `Étiquettes code-barres (${n})`,
          filename: `etiquette_variante_${variantId}`,
        });
      } catch {
        // Silently ignore — PDF is a convenience, not critical path
      } finally {
        setIsPrinting(false);
      }
    },
    [isPrinting]
  );

  return { printLabels, isPrinting };
}
