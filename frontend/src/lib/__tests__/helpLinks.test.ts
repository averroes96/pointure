import { describe, it, expect } from "vitest";
import { getHelpUrl, normalizeManualLang } from "../helpLinks";

describe("helpLinks", () => {
  describe("normalizeManualLang", () => {
    it("defaults to fr when empty or unknown", () => {
      expect(normalizeManualLang()).toBe("fr");
      expect(normalizeManualLang("")).toBe("fr");
      expect(normalizeManualLang("es")).toBe("fr");
      expect(normalizeManualLang("de-DE")).toBe("fr");
    });

    it("normalizes fr variants to fr", () => {
      expect(normalizeManualLang("fr")).toBe("fr");
      expect(normalizeManualLang("fr-DZ")).toBe("fr");
      expect(normalizeManualLang("fr-FR")).toBe("fr");
    });

    it("normalizes ar variants to ar", () => {
      expect(normalizeManualLang("ar")).toBe("ar");
      expect(normalizeManualLang("ar-DZ")).toBe("ar");
    });

    it("normalizes en variants to en", () => {
      expect(normalizeManualLang("en")).toBe("en");
      expect(normalizeManualLang("en-US")).toBe("en");
    });
  });

  describe("getHelpUrl", () => {
    it("routes cashier role to cashier.html with context anchor", () => {
      expect(getHelpUrl("/sales/new", "cashier", "fr")).toBe("/manual/fr/cashier.html#encaisser");
      expect(getHelpUrl("/closing", "cashier", "ar-DZ")).toBe("/manual/ar/cashier.html#fermer-caisse");
      expect(getHelpUrl("/sales/history", "cashier", "en")).toBe("/manual/en/cashier.html#retour-echange");
    });

    it("routes manager or owner to owner.html with context anchor", () => {
      expect(getHelpUrl("/inventory/stocktake", "manager", "fr")).toBe("/manual/fr/owner.html#inventaire");
      expect(getHelpUrl("/inventory", "owner", "ar")).toBe("/manual/ar/owner.html#produits");
      expect(getHelpUrl("/settings/desktop", "owner", "en")).toBe("/manual/en/owner.html#sauvegardes");
      expect(getHelpUrl("/settings", "manager", "fr")).toBe("/manual/fr/owner.html#premier-demarrage");
    });

    it("defaults unknown paths to the guide cover anchor", () => {
      expect(getHelpUrl("/unknown-path", "cashier", "fr")).toBe("/manual/fr/cashier.html#guide-caisse");
      expect(getHelpUrl("/unknown-path", "owner", "fr")).toBe("/manual/fr/owner.html#guide-gestionnaire");
      expect(getHelpUrl("/unknown-path", undefined, "fr")).toBe("/manual/fr/owner.html#guide-gestionnaire");
    });
  });
});
