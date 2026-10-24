/**
 * Centralized PDF Document Viewer utility for ShoeDZ.
 *
 * In Electron desktop mode, avoids blank child frames caused by Chromium blob: URL
 * isolation by streaming the PDF data via IPC to the main process where it renders
 * natively in Chromium's internal PDFium viewer or the default system PDF application.
 *
 * In web mode, falls back to standard window.open with blob: URLs.
 */

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

export interface ViewPdfOptions {
  title?: string;
  filename?: string;
}

export async function viewPdfDocument(
  data: Blob | ArrayBuffer,
  options: ViewPdfOptions = {}
): Promise<void> {
  const title = options.title || "Document PDF";
  const filename = options.filename || "document";

  // Desktop App: native IPC viewer
  if (window.electronAPI?.isDesktop && typeof window.electronAPI?.viewPdf === "function") {
    try {
      let base64: string;
      if (data instanceof Blob) {
        const buffer = await data.arrayBuffer();
        base64 = arrayBufferToBase64(buffer);
      } else {
        base64 = arrayBufferToBase64(data);
      }
      const res = await window.electronAPI.viewPdf({ base64, title, filename });
      if (res?.success) return;
      console.warn("viewPdf failed via Electron, falling back to web popup:", res?.error);
    } catch (err) {
      console.error("Error invoking viewPdf:", err);
    }
  }

  // Web Browser: standard blob popup
  const blob = data instanceof Blob ? data : new Blob([data], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, "_blank");
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  if (!win) {
    const a = document.createElement("a");
    a.href = url;
    a.download = `${filename}.pdf`;
    a.click();
  }
}
