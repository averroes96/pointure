import { act, render, screen } from "@testing-library/react";
import { afterAll, describe, expect, it } from "vitest";
import i18n from "@/lib/i18n";
import type { BestSellerRow } from "@/types";
import BestSellersCard, { BEST_SELLERS_DAYS, bestSellersUrl } from "../BestSellersCard";

const ROWS = Array.from({ length: 7 }, (_, i) => ({
  product_id: `p-${i}`,
  product_name: `Modèle ${i + 1}`,
  brand: "Marque",
  units_sold: 30 - i,
  revenue: "1000.00",
})) as unknown as BestSellerRow[];

describe("BestSellersCard", () => {
  afterAll(async () => {
    await i18n.changeLanguage("fr");
  });

  it("asks the server for the period it shows", () => {
    expect(BEST_SELLERS_DAYS).toBe(90);
    expect(bestSellersUrl()).toBe("/reports/best-sellers/?days=90");
    expect(bestSellersUrl(30)).toBe("/reports/best-sellers/?days=30");
  });

  it.each([
    ["fr", "90 derniers jours"],
    ["en", "Last 90 days"],
    ["ar", "آخر 90 يومًا"],
  ])("labels the period in %s", async (language, label) => {
    await act(async () => {
      await i18n.changeLanguage(language);
    });
    render(<BestSellersCard rows={ROWS} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it("shows the top five in order", async () => {
    await act(async () => {
      await i18n.changeLanguage("fr");
    });
    render(<BestSellersCard rows={ROWS} />);
    const names = screen.getAllByText(/^Modèle \d$/).map((node) => node.textContent);
    expect(names).toEqual(["Modèle 1", "Modèle 2", "Modèle 3", "Modèle 4", "Modèle 5"]);
  });

  it("says when there is nothing to rank", async () => {
    await act(async () => {
      await i18n.changeLanguage("fr");
    });
    render(<BestSellersCard rows={[]} />);
    expect(screen.getByText(i18n.t("common.no_data"))).toBeInTheDocument();
  });
});
