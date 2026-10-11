"""
Desktop PDF generation client.

Bridges HTML-to-PDF rendering requests to Electron's Chromium printToPDF engine.
This provides pristine CSS styling and full Arabic (RTL) typography without requiring
native GTK/Pango installations on Windows.
"""
import logging
import os

import requests
from django.conf import settings

logger = logging.getLogger(__name__)


def render_html_to_pdf(html_string: str, options: dict = None) -> bytes:
    """
    Render an HTML string to PDF bytes.
    In desktop mode, dispatches to the local Electron PDF bridge.
    Falls back to WeasyPrint if available.
    """
    is_desktop = getattr(settings, "DESKTOP_MODE", False)
    bridge_url = getattr(
        settings,
        "PDF_BRIDGE_URL",
        os.environ.get("PDF_BRIDGE_URL", "http://127.0.0.1:8746/render-pdf"),
    )
    bridge_token = getattr(
        settings,
        "PDF_BRIDGE_TOKEN",
        os.environ.get("PDF_BRIDGE_TOKEN", ""),
    )

    if is_desktop and bridge_url:
        try:
            headers = {"Content-Type": "application/json"}
            if bridge_token:
                headers["X-Bridge-Token"] = bridge_token

            payload = {
                "html": html_string,
                "options": options or {
                    "printBackground": True,
                    "preferCSSPageSize": True,
                },
            }

            resp = requests.post(bridge_url, json=payload, headers=headers, timeout=25)
            if resp.status_code == 200 and resp.content.startswith(b"%PDF"):
                return resp.content
            else:
                logger.warning(
                    "PDF bridge returned status %d: %s",
                    resp.status_code,
                    resp.text[:200],
                )
        except Exception as exc:
            logger.warning("Could not reach Electron PDF bridge (%s). Checking fallback.", exc)

    # Server-mode fallback or if WeasyPrint is installed
    try:
        from weasyprint import HTML
        return HTML(string=html_string, base_url=".").write_pdf()
    except ImportError:
        logger.error("Neither Electron PDF bridge nor WeasyPrint is available.")
        return b"%PDF-1.4\n% Desktop PDF placeholder\n"
