/**
 * Contextual help links for ShoeDZ.
 * Maps application routes and user roles to the corresponding guide and section anchor in the user manual.
 */

export interface HelpRouteMapping {
  prefix: string;
  cashierAnchor?: string;
  ownerAnchor?: string;
}

export const ROUTE_ANCHOR_MAP: HelpRouteMapping[] = [
  // POS & Sales
  { prefix: "/sales/new", cashierAnchor: "encaisser", ownerAnchor: "encaisser" },
  { prefix: "/sales/history", cashierAnchor: "retours-echanges", ownerAnchor: "clotures-rapports" },
  { prefix: "/sales", cashierAnchor: "encaisser", ownerAnchor: "encaisser" },

  // Inventory, Stocks & Products
  { prefix: "/inventory/stocktake", cashierAnchor: "connexion", ownerAnchor: "stocks-inventaire" },
  { prefix: "/inventory/transfer", cashierAnchor: "connexion", ownerAnchor: "stocks-inventaire" },
  { prefix: "/inventory/movements", cashierAnchor: "connexion", ownerAnchor: "stocks-inventaire" },
  { prefix: "/inventory/low-stock", cashierAnchor: "connexion", ownerAnchor: "stocks-inventaire" },
  { prefix: "/inventory/defects", cashierAnchor: "connexion", ownerAnchor: "stocks-inventaire" },
  { prefix: "/inventory", cashierAnchor: "connexion", ownerAnchor: "articles-variantes" },
  { prefix: "/products", cashierAnchor: "connexion", ownerAnchor: "articles-variantes" },

  // Cash sessions & Closing
  { prefix: "/closing", cashierAnchor: "fermer-caisse", ownerAnchor: "clotures-rapports" },

  // Clients & Layaway / Versements
  { prefix: "/clients", cashierAnchor: "versement-acompte", ownerAnchor: "facturation-b2b" },

  // Suppliers & Purchases
  { prefix: "/suppliers", cashierAnchor: "connexion", ownerAnchor: "fournisseurs-achats" },
  { prefix: "/purchase-orders", cashierAnchor: "connexion", ownerAnchor: "fournisseurs-achats" },

  // Invoicing & Delivery Notes
  { prefix: "/invoices", cashierAnchor: "connexion", ownerAnchor: "facturation-b2b" },
  { prefix: "/delivery-notes", cashierAnchor: "connexion", ownerAnchor: "facturation-b2b" },
  { prefix: "/credit-notes", cashierAnchor: "retours-echanges", ownerAnchor: "facturation-b2b" },

  // Reports
  { prefix: "/reports", cashierAnchor: "fermer-caisse", ownerAnchor: "clotures-rapports" },

  // Settings & Desktop
  { prefix: "/settings/desktop", cashierAnchor: "connexion", ownerAnchor: "sauvegardes-securite" },
  { prefix: "/settings", cashierAnchor: "connexion", ownerAnchor: "configuration-initiale" },

  // Auth / Login
  { prefix: "/login", cashierAnchor: "connexion", ownerAnchor: "connexion" },
];

/**
 * Normalizes language string to supported manual locale ('fr', 'ar', 'en').
 * Defaults to 'fr'.
 */
export function normalizeManualLang(lang?: string): "fr" | "ar" | "en" {
  if (!lang) return "fr";
  const lower = lang.toLowerCase();
  if (lower.startsWith("ar")) return "ar";
  if (lower.startsWith("en")) return "en";
  return "fr";
}

/**
 * Resolves the user manual URL with section anchor for a given route, role, and language.
 */
export function getHelpUrl(pathname: string, role?: string, lang?: string): string {
  const guide = role === "cashier" ? "cashier" : "owner";
  const resolvedLang = normalizeManualLang(lang);

  const cleanPath = (pathname || "/").split("?")[0].split("#")[0];
  const match = ROUTE_ANCHOR_MAP.find((m) => cleanPath.startsWith(m.prefix));

  let anchor = "";
  if (match) {
    anchor = (guide === "cashier" ? match.cashierAnchor : match.ownerAnchor) || "";
  }

  if (!anchor) {
    anchor = guide === "cashier" ? "guide-caisse" : "guide-gestionnaire";
  }

  return `/manual/${resolvedLang}/${guide}.html${anchor ? `#${anchor}` : ""}`;
}

/**
 * Opens the manual in a new window/tab.
 * In Electron desktop app, this is handled by setWindowOpenHandler and opens in an in-app window.
 */
export function openHelp(pathname: string, role?: string, lang?: string): void {
  const url = getHelpUrl(pathname, role, lang);
  window.open(url, "_blank");
}

