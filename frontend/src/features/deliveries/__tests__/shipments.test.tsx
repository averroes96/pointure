import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import i18n from "@/lib/i18n";
import fr from "@/locales/fr.json";
import ar from "@/locales/ar.json";
import en from "@/locales/en.json";
import ShipmentSummaryCards from "../components/ShipmentSummaryCards";
import {
  EMPTY_FILTERS,
  buildShipmentParams,
  cashTone,
  formatDateTime,
  statusTone,
  summarizeShipments,
} from "../shipments";
import { CASH_STATUSES, SHIPMENT_STATUSES } from "../types";
import type { ShipmentSummary } from "../types";

const t = i18n.t.bind(i18n);

describe("buildShipmentParams", () => {
  it("keeps only non-empty filters and the page after the first", () => {
    expect(buildShipmentParams(EMPTY_FILTERS)).toEqual({});
    expect(buildShipmentParams({ ...EMPTY_FILTERS, status: "delivered", search: "  T1 " }, 3)).toEqual({
      status: "delivered", search: "T1", page: "3",
    });
  });
});

describe("tones", () => {
  it("maps every status and cash state to a badge tone", () => {
    expect(SHIPMENT_STATUSES.map((s) => [s, statusTone(s)])).toEqual([
      ["created", "neutral"], ["pending_pickup", "neutral"], ["picked_up", "info"], ["in_transit", "info"],
      ["at_hub", "info"], ["out_for_delivery", "info"], ["delivery_attempted", "warning"], ["delivered", "success"],
      ["on_hold", "warning"], ["return_in_transit", "warning"], ["returned", "danger"], ["cancelled", "danger"],
      ["lost", "danger"], ["unknown", "neutral"],
    ]);
    expect(CASH_STATUSES.map((c) => [c, cashTone(c)])).toEqual([
      ["awaiting_delivery", "neutral"], ["held_by_courier", "warning"], ["ready", "info"], ["paid", "success"],
      ["not_applicable", "neutral"],
    ]);
  });
});

describe("translations", () => {
  const ERRORS = ["auth_refused", "forbidden", "unreachable", "rate_limited", "key_scope", "unknown_courier",
    "no_connector", "no_base_url", "partial", "connector_error", "error"];
  type Groups = { shipment_status: Record<string, string>; cash_status: Record<string, string>; sync_error: Record<string, string> };
  const locales: [string, Groups][] = [["fr", fr.deliveries], ["ar", ar.deliveries], ["en", en.deliveries]];

  it.each(locales)("%s has a label for every status, cash state and sync error", (_, d) => {
    for (const s of SHIPMENT_STATUSES) expect(d.shipment_status[s], s).toBeTruthy();
    for (const c of CASH_STATUSES) expect(d.cash_status[c], c).toBeTruthy();
    for (const e of ERRORS) expect(d.sync_error[e], e).toBeTruthy();
  });
});

const SUMMARY: ShipmentSummary = {
  couriers: [
    {
      courier: "maystro", courier_name: "Maystro", total: 9,
      by_status: { delivered: 4, out_for_delivery: 2, delivery_attempted: 1, on_hold: 1, returned: 1 },
      by_cash: {
        held_by_courier: { count: 2, cod_amount: "9800.00", store_amount: "9000.10" },
        paid: { count: 2, cod_amount: "9800.00", store_amount: "9000.00" },
        ready: { count: 1, cod_amount: "4900.00", store_amount: "4500.00" },
      },
    },
    {
      courier: "yalidine", courier_name: "Yalidine", total: 1,
      by_status: { in_transit: 1 },
      by_cash: { held_by_courier: { count: 1, cod_amount: "100.00", store_amount: "0.20" } },
    },
  ],
  accounts: [],
};

describe("summarizeShipments", () => {
  it("adds counts and money (in cents) across couriers", () => {
    expect(summarizeShipments(SUMMARY)).toEqual({
      inProgress: 5,           // out_for_delivery 2 + attempted 1 + on_hold 1 + in_transit 1
      followUp: 2,
      held: { count: 3, amount: "9000.30" },
      ready: { count: 1, amount: "4500.00" },
      paid: { count: 2, amount: "9000.00" },
      returned: 1,
    });
  });

  it("is all zeros without data", () => {
    expect(summarizeShipments(undefined).held).toEqual({ count: 0, amount: "0.00" });
  });
});

describe("ShipmentSummaryCards", () => {
  it("selects and clears a card", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const cards = summarizeShipments(SUMMARY);
    const { rerender } = render(<ShipmentSummaryCards cards={cards} active={null} onSelect={onSelect} />);

    await user.click(screen.getByRole("button", { name: new RegExp(t("deliveries.card_follow_up")) }));
    expect(onSelect).toHaveBeenLastCalledWith("follow_up");

    rerender(<ShipmentSummaryCards cards={cards} active="follow_up" onSelect={onSelect} />);
    const pressed = screen.getByRole("button", { pressed: true });
    expect(pressed).toHaveTextContent(t("deliveries.card_follow_up"));
    await user.click(pressed);
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });
});

describe("formatDateTime", () => {
  it("returns a dash for empty values and the input for invalid dates", () => {
    expect(formatDateTime(null)).toBe("—");
    expect(formatDateTime("not-a-date")).toBe("not-a-date");
    expect(formatDateTime("2026-11-16T10:00:00Z", "en")).toMatch(/2026/);
  });
});
