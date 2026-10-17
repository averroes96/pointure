import { useEffect, useCallback, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";

export function useGlobalShortcuts() {
  const navigate = useNavigate();
  const location = useLocation();
  const lastTriggerRef = useRef<{ key: string; time: number }>({ key: "", time: 0 });

  const executeShortcut = useCallback(
    (key: string, e?: { altKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; preventDefault?: () => void }) => {
      const now = Date.now();
      // Deduplicate rapid dual-firing (e.g. IPC and DOM within 75ms)
      if (lastTriggerRef.current.key === key && now - lastTriggerRef.current.time < 75) {
        return;
      }
      lastTriggerRef.current = { key, time: now };

      const isShift = !!e?.shiftKey;
      const normalizedPath = location.pathname.split("?")[0].replace(/\/+$/, "");
      const isSalesNew = normalizedPath === "/sales/new";

      switch (key) {
        // F1 or Alt+1: Caisse POS / Nouvelle vente
        case "F1":
        case "Alt+1": {
          e?.preventDefault?.();
          if (isSalesNew) {
            window.dispatchEvent(new CustomEvent("app-shortcut-new-sale"));
          } else {
            navigate("/sales/new");
          }
          break;
        }

        // F2 or Alt+2: Rechercher un produit, client ou document
        case "F2":
        case "Alt+2": {
          e?.preventDefault?.();
          window.electronAPI?.focusWindow?.();
          if (isSalesNew) {
            window.dispatchEvent(new CustomEvent("app-shortcut-search"));
          }
          // Direct DOM fallback to guarantee focus even if event propagation is delayed
          const searchInput = document.querySelector<HTMLInputElement>(
            'input[data-shortcut-search="true"], input[type="search"], input[placeholder*="search" i], input[placeholder*="recherch" i], input[placeholder*="بحث" i]'
          );
          if (searchInput) {
            searchInput.focus();
            searchInput.select();
          } else if (!isSalesNew) {
            navigate("/sales/new");
            setTimeout(() => {
              window.electronAPI?.focusWindow?.();
              window.dispatchEvent(new CustomEvent("app-shortcut-search"));
              const input = document.querySelector<HTMLInputElement>('input[data-shortcut-search="true"]');
              input?.focus();
            }, 120);
          }
          break;
        }

        // F3 or Alt+3: Factures / Invoices (Shift+F3: Nouvelle facture)
        case "F3":
        case "Alt+3": {
          e?.preventDefault?.();
          if (isShift) {
            navigate("/invoices/new");
          } else {
            navigate("/invoices");
          }
          break;
        }

        // F4 or Alt+4: Clients (Shift+F4: Nouveau client)
        case "F4":
        case "Alt+4": {
          e?.preventDefault?.();
          if (isShift) {
            navigate("/clients/new");
          } else {
            navigate("/clients");
          }
          break;
        }

        // F5 or Alt+5 or Alt+M: Ouvrir / Basculer le menu latéral
        case "F5":
        case "Alt+5":
        case "Alt+m":
        case "Alt+M": {
          e?.preventDefault?.();
          window.dispatchEvent(new CustomEvent("app-toggle-sidebar"));
          break;
        }

        // F6 or Alt+6: Bons de livraison / Vouchers (Shift+F6: Nouveau bon)
        case "F6":
        case "Alt+6": {
          e?.preventDefault?.();
          if (isShift) {
            navigate("/delivery-notes/new");
          } else {
            navigate("/delivery-notes");
          }
          break;
        }

        // F7 or Alt+7: Clôture de caisse / Daily report
        case "F7":
        case "Alt+7": {
          e?.preventDefault?.();
          navigate("/reports/daily");
          break;
        }

        // F8 or Alt+8: Produits / Stock
        case "F8":
        case "Alt+8": {
          e?.preventDefault?.();
          navigate("/inventory/products");
          break;
        }

        // F9 or Alt+9: Nouveau Produit
        case "F9":
        case "Alt+9": {
          e?.preventDefault?.();
          navigate("/inventory/products/new");
          break;
        }

        // F10: Confirmer la vente sur la caisse ou valider le modal/formulaire
        case "F10": {
          e?.preventDefault?.();
          if (isSalesNew) {
            window.dispatchEvent(new CustomEvent("app-shortcut-confirm"));
          } else {
            // Find active dialog submit button or form submit button
            const submitBtn = document.querySelector<HTMLButtonElement>(
              'div[role="dialog"] button[type="submit"], div[role="dialog"] .btn-primary, form button[type="submit"]'
            );
            if (submitBtn && !submitBtn.disabled) {
              submitBtn.click();
            } else {
              window.dispatchEvent(new CustomEvent("app-shortcut-confirm"));
            }
          }
          break;
        }

        // F11: Basculer Plein écran
        case "F11": {
          e?.preventDefault?.();
          if (window.electronAPI?.toggleFullscreen) {
            window.electronAPI.toggleFullscreen();
          } else {
            if (!document.fullscreenElement) {
              document.documentElement.requestFullscreen().catch(() => {});
            } else {
              document.exitFullscreen().catch(() => {});
            }
          }
          break;
        }

        // F12: Guide des raccourcis clavier
        case "F12": {
          e?.preventDefault?.();
          window.dispatchEvent(new CustomEvent("app-toggle-shortcuts-modal"));
          break;
        }

        // Alt+P / Alt+S / Ctrl+, : Paramètres / Configuration
        case "Alt+p":
        case "Alt+P":
        case "Alt+s":
        case "Alt+S":
        case "Ctrl+,": {
          e?.preventDefault?.();
          window.electronAPI?.focusWindow?.();
          navigate("/settings");
          break;
        }

        // Escape: Fermer modale ou effacer recherche
        case "Escape": {
          window.dispatchEvent(new CustomEvent("app-shortcut-escape"));
          break;
        }

        default:
          break;
      }
    },
    [navigate, location.pathname]
  );

  useEffect(() => {
    // 1. Electron IPC shortcuts channel (primary on Windows Desktop)
    const cleanupElectron = window.electronAPI?.onShortcut?.((data) => {
      executeShortcut(data.key, {
        altKey: data.altKey,
        ctrlKey: data.ctrlKey,
        shiftKey: data.shiftKey,
      });
    });

    // 2. DOM keydown listener (fallback for web / when Electron before-input-event did not intercept)
    const handleKeyDown = (e: KeyboardEvent) => {
      const isFKey = /^F([1-9]|1[0-2])$/.test(e.key);
      const isAltNumber = e.altKey && !e.ctrlKey && /^[1-9]$/.test(e.key);
      const isAltM = e.altKey && !e.ctrlKey && (e.key === "m" || e.key === "M");
      const isAltP = e.altKey && !e.ctrlKey && (e.key === "p" || e.key === "P");
      const isAltS = e.altKey && !e.ctrlKey && (e.key === "s" || e.key === "S");
      const isCtrlComma = (e.ctrlKey || e.metaKey) && (e.key === "," || e.code === "Comma");

      // Never ignore Function keys or Alt shortcuts or Ctrl+, or Escape, even when typing inside an input or textarea!
      if (!isFKey && !isAltNumber && !isAltM && !isAltP && !isAltS && !isCtrlComma && e.key !== "Escape") {
        const target = e.target as HTMLElement;
        if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
          return;
        }
      }

      if (isFKey) {
        executeShortcut(e.key, e);
      } else if (isAltNumber) {
        executeShortcut(`Alt+${e.key}`, e);
      } else if (isAltM) {
        executeShortcut("Alt+M", e);
      } else if (isAltP) {
        executeShortcut("Alt+P", e);
      } else if (isAltS) {
        executeShortcut("Alt+S", e);
      } else if (isCtrlComma) {
        executeShortcut("Ctrl+,", e);
      } else if (e.key === "Escape") {
        executeShortcut("Escape", e);
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      cleanupElectron?.();
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [executeShortcut]);
}

