import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

export function useGlobalShortcuts() {
  const navigate = useNavigate();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger shortcuts if the user is typing in an input or textarea
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) {
        return;
      }
      let action = null;

      if (e.key === "F1" || (e.altKey && e.key === "1")) action = "/sales/new";
      else if (e.key === "F2" || (e.altKey && e.key === "2")) action = "/";
      else if (e.key === "F3" || (e.altKey && e.key === "3")) action = "/invoices";
      else if (e.key === "F4" || (e.altKey && e.key === "4")) action = "/clients";
      else if (e.key === "F7" || (e.altKey && e.key === "7")) action = "/reports/daily";
      else if (e.key === "F8" || (e.altKey && e.key === "8")) action = "/inventory/products";

      if (action) {
        e.preventDefault();
        navigate(action);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [navigate]);
}
