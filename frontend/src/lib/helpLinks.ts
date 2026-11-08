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
  { prefix: "/sales/new", cashierAnchor: "encaisser", ownerAnchor: "rapports" },
  { prefix: "/sales/history", cashierAnchor: "retour-echange", ownerAnchor: "rapports" },
  { prefix: "/sales/reconciliation", cashierAnchor: "fermer-caisse", ownerAnchor: "rapports" },
  { prefix: "/sales", cashierAnchor: "encaisser", ownerAnchor: "rapports" },

  // Promotions & Loyalty
  { prefix: "/promotions", cashierAnchor: "fidelite-promotions", ownerAnchor: "promotions-fidelite" },
  { prefix: "/loyalty", cashierAnchor: "fidelite-promotions", ownerAnchor: "promotions-fidelite" },

  // Inventory, Stocks & Products
  { prefix: "/inventory/stocktake", cashierAnchor: "connexion", ownerAnchor: "inventaire" },
  { prefix: "/inventory/transfers", cashierAnchor: "connexion", ownerAnchor: "inventaire" },
  { prefix: "/inventory/transfer", cashierAnchor: "connexion", ownerAnchor: "inventaire" },
  { prefix: "/inventory/movements", cashierAnchor: "connexion", ownerAnchor: "inventaire" },
  { prefix: "/inventory/low-stock", cashierAnchor: "connexion", ownerAnchor: "inventaire" },
  { prefix: "/inventory/defects", cashierAnchor: "connexion", ownerAnchor: "inventaire" },
  { prefix: "/inventory/scanner", cashierAnchor: "rechercher-scanner", ownerAnchor: "produits" },
  { prefix: "/inventory", cashierAnchor: "connexion", ownerAnchor: "produits" },
  { prefix: "/products", cashierAnchor: "connexion", ownerAnchor: "produits" },

  // Cash sessions & Closing
  { prefix: "/closing", cashierAnchor: "fermer-caisse", ownerAnchor: "cloture-exercice" },

  // Clients, Cheques & Layaway / Versements
  { prefix: "/clients", cashierAnchor: "versement-reservation", ownerAnchor: "clients-credit" },
  { prefix: "/cheques", cashierAnchor: "versement-reservation", ownerAnchor: "clients-credit" },

  // Suppliers & Purchases
  { prefix: "/suppliers", cashierAnchor: "connexion", ownerAnchor: "achats-reception" },
  { prefix: "/purchase-orders", cashierAnchor: "connexion", ownerAnchor: "achats-reception" },

  // Invoicing & Delivery Notes
  { prefix: "/invoices", cashierAnchor: "connexion", ownerAnchor: "facturation" },
  { prefix: "/quotes", cashierAnchor: "connexion", ownerAnchor: "facturation" },
  { prefix: "/delivery-notes", cashierAnchor: "connexion", ownerAnchor: "facturation" },
  { prefix: "/credit-notes", cashierAnchor: "retour-echange", ownerAnchor: "facturation" },

  // Reports
  { prefix: "/reports", cashierAnchor: "fermer-caisse", ownerAnchor: "rapports" },

  // Settings, Audit & Desktop
  { prefix: "/settings/desktop", cashierAnchor: "connexion", ownerAnchor: "sauvegardes" },
  { prefix: "/settings/audit-log", cashierAnchor: "connexion", ownerAnchor: "audit" },
  { prefix: "/settings", cashierAnchor: "connexion", ownerAnchor: "premier-demarrage" },

  // Auth / Login
  { prefix: "/login", cashierAnchor: "connexion", ownerAnchor: "premier-demarrage" },
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
