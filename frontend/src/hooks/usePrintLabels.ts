/**
 * usePrintLabels — shared hook for printing barcode labels.
 *
 * Uses triggerLabelPrint() to either open the integrated thermal label
 * print dialog or print instantly/silently (depending on the user's
 * configured preference in Settings > Imprimantes).
 *
 * Usage:
 *   const { printLabels, isPrinting } = usePrintLabels();
 *   printLabels(variantId, copies);
 */
import { useState, useCallback } from "react";
import api from "@/lib/api";
import { triggerLabelPrint } from "@/features/inventory/components/labelPrintStore";

export function usePrintLabels() {
  const [isPrinting, setIsPrinting] = useState(false);

  const printLabels = useCallback(
    async (variantId: number | string, copies = 1) => {
      if (isPrinting) return;
      setIsPrinting(true);
      try {
        const n = Math.max(1, Math.min(Math.round(Number(copies)), 200));
        await triggerLabelPrint({
          title: `Étiquettes code-barres (${n})`,
          defaultCopies: n,
          fetchHtml: async ({ w, h, copies: count }) => {
            const res = await api.get(
              `/inventory/variants/${variantId}/barcode-label/?output=html&w=${w}&h=${h}&copies=${count}`,
              { responseType: "text" }
            );
            return res.data;
          },
        });
      } catch {
        // Silently ignore
      } finally {
        setIsPrinting(false);
      }
    },
    [isPrinting]
  );

  return { printLabels, isPrinting };
}
