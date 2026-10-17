import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { X, Keyboard, ShoppingCart, Package, Sparkles } from "lucide-react";

interface ShortcutItem {
  key: string;
  label: string;
  desc?: string;
}

export default function ShortcutsModal() {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const handleToggle = () => setIsOpen((prev) => !prev);
    const handleOpen = () => setIsOpen(true);
    const handleClose = () => setIsOpen(false);

    window.addEventListener("app-toggle-shortcuts-modal", handleToggle);
    window.addEventListener("app-open-shortcuts-modal", handleOpen);
    window.addEventListener("app-shortcut-escape", handleClose);

    return () => {
      window.removeEventListener("app-toggle-shortcuts-modal", handleToggle);
      window.removeEventListener("app-open-shortcuts-modal", handleOpen);
      window.removeEventListener("app-shortcut-escape", handleClose);
    };
  }, []);

  if (!isOpen) return null;

  const posShortcuts: ShortcutItem[] = [
    { key: "F1", label: t("shortcuts.new_sale", "Nouvelle vente / Caisse POS"), desc: "Alt + 1" },
    { key: "F2", label: t("shortcuts.search", "Rechercher un produit / scanner"), desc: "Alt + 2" },
    { key: "Échap", label: t("shortcuts.clear_cart", "Vider le panier / Effacer recherche") },
    { key: "F10 · .", label: t("shortcuts.confirm_sale", "Confirmer & Encaisser la vente"), desc: t("shortcuts.confirm_sale_desc", "Touche F10 ou touche point \".\" du pavé numérique") },
    { key: "F11", label: t("shortcuts.fullscreen", "Plein écran (Mode caisse magasin)") },
  ];

  const managementShortcuts: ShortcutItem[] = [
    { key: "F3", label: t("shortcuts.invoices", "Factures"), desc: "Shift+F3 : Nouvelle facture" },
    { key: "F4", label: t("shortcuts.clients", "Clients"), desc: "Shift+F4 : Nouveau client" },
    { key: "F6", label: t("shortcuts.delivery_notes", "Bons de livraison / Vouchers"), desc: "Shift+F6 : Nouveau bon" },
    { key: "F7", label: t("shortcuts.daily_report", "Rapport journalier & Clôture de caisse"), desc: "Alt + 7" },
    { key: "F8", label: t("shortcuts.products", "Catalogue stock & Produits"), desc: "Alt + 8" },
    { key: "F9", label: t("shortcuts.new_product", "Créer un nouveau produit"), desc: "Alt + 9" },
  ];

  const generalShortcuts: ShortcutItem[] = [
    { key: "F5", label: t("shortcuts.sidebar", "Menu latéral (Navigation flèches ↑ ↓)"), desc: "Alt + M / Alt + 5 · Entrée pour ouvrir" },
    { key: "Alt + P", label: t("shortcuts.settings", "Paramètres & Configuration du magasin"), desc: "Ctrl + , · Alt + S" },
    { key: "Échap", label: t("shortcuts.escape", "Annuler, effacer recherche ou fermer modale") },
    { key: "F12", label: t("shortcuts.help", "Ouvrir ce guide des raccourcis") },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 animate-in fade-in duration-150"
      onClick={() => setIsOpen(false)}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col border border-border"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-surface-subtle">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary-50 text-primary-600 flex items-center justify-center shadow-xs">
              <Keyboard size={22} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-text-primary">
                  {t("shortcuts.title", "Raccourcis Clavier Windows")}
                </h2>
                <span className="px-2 py-0.5 text-2xs font-semibold rounded-full bg-primary-100 text-primary-700">
                  POS Store
                </span>
              </div>
              <p className="text-xs text-text-muted">
                {t("shortcuts.subtitle", "Actions rapides pour caisses et gestion en boutique")}
              </p>
            </div>
          </div>
          <button
            onClick={() => setIsOpen(false)}
            className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-6">
          {/* POS & Sales */}
          <div>
            <div className="flex items-center gap-2 text-xs font-bold text-text-secondary uppercase tracking-wider mb-3">
              <ShoppingCart size={15} className="text-primary-500" />
              <span>{t("shortcuts.section_pos", "Caisse & Vente directe")}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {posShortcuts.map((item) => (
                <div
                  key={item.key}
                  className="flex items-center justify-between p-2.5 rounded-xl border border-border bg-white hover:border-primary-200 transition-colors shadow-2xs"
                >
                  <div className="min-w-0 pr-2">
                    <p className="text-sm font-medium text-text-primary truncate">{item.label}</p>
                    {item.desc && <p className="text-2xs text-text-muted">{item.desc}</p>}
                  </div>
                  <kbd className="shrink-0 px-2.5 py-1 text-xs font-mono font-bold bg-surface border border-border rounded-lg text-primary-700 shadow-xs">
                    {item.key}
                  </kbd>
                </div>
              ))}
            </div>
          </div>

          {/* Management & Documents */}
          <div>
            <div className="flex items-center gap-2 text-xs font-bold text-text-secondary uppercase tracking-wider mb-3">
              <Package size={15} className="text-primary-500" />
              <span>{t("shortcuts.section_management", "Gestion & Documents")}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {managementShortcuts.map((item) => (
                <div
                  key={item.key}
                  className="flex items-center justify-between p-2.5 rounded-xl border border-border bg-white hover:border-primary-200 transition-colors shadow-2xs"
                >
                  <div className="min-w-0 pr-2">
                    <p className="text-sm font-medium text-text-primary truncate">{item.label}</p>
                    {item.desc && <p className="text-2xs text-text-muted">{item.desc}</p>}
                  </div>
                  <kbd className="shrink-0 px-2.5 py-1 text-xs font-mono font-bold bg-surface border border-border rounded-lg text-primary-700 shadow-xs">
                    {item.key}
                  </kbd>
                </div>
              ))}
            </div>
          </div>

          {/* System & General */}
          <div>
            <div className="flex items-center gap-2 text-xs font-bold text-text-secondary uppercase tracking-wider mb-3">
              <Sparkles size={15} className="text-primary-500" />
              <span>{t("shortcuts.section_general", "Général & Système")}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {generalShortcuts.map((item) => (
                <div
                  key={item.key}
                  className="flex items-center justify-between p-2.5 rounded-xl border border-border bg-white hover:border-primary-200 transition-colors shadow-2xs"
                >
                  <div className="min-w-0 pr-2">
                    <p className="text-sm font-medium text-text-primary truncate">{item.label}</p>
                  </div>
                  <kbd className="shrink-0 px-2.5 py-1 text-xs font-mono font-bold bg-surface border border-border rounded-lg text-primary-700 shadow-xs">
                    {item.key}
                  </kbd>
                </div>
              ))}
            </div>
          </div>

          {/* Info note */}
          <div className="p-3.5 rounded-xl bg-primary-50 border border-primary-100 flex items-start gap-2.5 text-xs text-primary-900">
            <span className="text-base leading-none">💡</span>
            <p>
              {t(
                "shortcuts.store_note",
                "Ces touches de fonction sont actives en permanence sous Windows, même lorsque votre curseur est positionné à l'intérieur d'un champ de saisie (recherche, quantité ou code-barres)."
              )}
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-border bg-surface flex justify-end">
          <button onClick={() => setIsOpen(false)} className="btn-secondary px-5">
            {t("common.close", "Fermer")}
          </button>
        </div>
      </div>
    </div>
  );
}
