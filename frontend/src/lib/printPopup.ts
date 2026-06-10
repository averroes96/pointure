/**
 * Shared print popup utility.
 *
 * Opens a standalone popup with the provided HTML, measures the rendered
 * content height, injects an exact @page size into the document, then
 * triggers window.print(). This ensures there is no blank space below the
 * content in the print preview regardless of the browser's default paper size.
 *
 * @param html       Full HTML document string (including <html>, <head>, <body>).
 * @param pageWidth  CSS width string for @page (e.g. "80mm" or "210mm").
 * @param marginMm   Extra mm added to the measured height (default 4).
 */
export function openPrintPopup(
  html: string,
  pageWidth: string,
  marginMm = 4
): void {
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const blobUrl = URL.createObjectURL(blob);

  const popup = window.open(
    blobUrl,
    "_blank",
    "width=800,height=600,toolbar=0,menubar=0,scrollbars=0"
  );

  if (!popup) {
    URL.revokeObjectURL(blobUrl);
    alert("Autorisez les popups dans votre navigateur pour imprimer.");
    return;
  }

  popup.focus();

  let printed = false;

  popup.onload = () => {
    if (printed) return;
    printed = true;

    try {
      const body = popup.document.body;
      const heightPx = body.scrollHeight;
      // 1 mm ≈ 3.7795 px at 96 DPI
      const heightMm = Math.ceil(heightPx / 3.7795) + marginMm;

      // Inject exact @page dimensions after content is rendered
      const style = popup.document.createElement("style");
      style.textContent = `@media print { @page { size: ${pageWidth} ${heightMm}mm; margin: 0; } }`;
      popup.document.head.appendChild(style);

      // Resize the popup window to match content
      popup.resizeTo(popup.outerWidth, heightPx + 80);
    } catch (_) {
      /* resizeTo / style injection blocked by browser policy — proceed anyway */
    }

    popup.print();
    URL.revokeObjectURL(blobUrl);
  };

  // Fallback: if onload already fired before we assigned the handler
  setTimeout(() => {
    if (printed) return;
    printed = true;
    try { popup.print(); } catch (_) { /* ignore */ }
  }, 800);
}
