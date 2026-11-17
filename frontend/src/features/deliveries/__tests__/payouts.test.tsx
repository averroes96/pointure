import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import i18n from "@/lib/i18n";
import { differenceTone, parseTrackings, payoutDateLabel, payoutDifference } from "../payouts";
import { formatDate } from "@/lib/api";
import { formatMoney } from "../shipments";

const t = i18n.t.bind(i18n);

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, default: { get, post } };
});

import ConfirmPayoutModal from "../components/ConfirmPayoutModal";
import ManualPayoutModal from "../components/ManualPayoutModal";
import PayoutsToConfirm from "../components/PayoutsToConfirm";

function withQuery(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const ITEM = { courier_payout_ref: "mp-9", paid_on: "2026-11-16", count: 12, expected_amount: "54000.00" };

describe("helpers", () => {
  it("parseTrackings splits, trims and de-duplicates", () => {
    expect(parseTrackings(" T1\nT2, T3;T1\r\n\n  T4 ")).toEqual(["T1", "T2", "T3", "T4"]);
    expect(parseTrackings("   ")).toEqual([]);
  });

  it("payoutDifference works in cents", () => {
    expect(payoutDifference("7000", "7150.00")).toBe("-150.00");
    expect(payoutDifference("0,10", "0.20")).toBe("-0.10");
    expect(payoutDifference("abc", "1")).toBe("");
    expect([differenceTone("0.00"), differenceTone("-1.00"), differenceTone("5.00"), differenceTone("")]).toEqual(
      ["success", "danger", "warning", "neutral"],
    );
  });

  it("payoutDateLabel says when the courier gives no payment date (Yalidine)", () => {
    expect(payoutDateLabel(t, { paid_on: "2026-11-16", courier_payout_ref: "mp-9" }, "fr"))
      .toBe(formatDate("2026-11-16", "fr"));
    expect(payoutDateLabel(t, { paid_on: null, courier_payout_ref: "M-5" }))
      .toBe(t("deliveries.payout_no_date", { ref: "M-5" }));
  });

  it("formatMoney adds the currency, and keeps the dash for missing values", () => {
    expect(formatMoney("4900", "en")).toBe("4,900.00 DZD");
    expect(formatMoney(null)).toBe("—");
  });
});

describe("ConfirmPayoutModal", () => {
  beforeEach(() => { get.mockReset(); post.mockReset(); });

  it("prefills the expected amount and records the counted one, never totals", async () => {
    const user = userEvent.setup();
    post.mockResolvedValue({ data: { id: "p1" } });
    const onClose = vi.fn();
    withQuery(<ConfirmPayoutModal courier="maystro" courierName="Maystro" item={ITEM} onClose={onClose} />);

    const amount = screen.getByLabelText(t("deliveries.payout_amount_counted"));
    expect(amount).toHaveValue("54000.00");
    await user.clear(amount);
    await user.type(amount, "53900");
    expect(screen.getByText(formatMoney("-100.00", i18n.language))).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: t("deliveries.payout_confirm") }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const [url, body] = post.mock.calls[0];
    expect(url).toBe("/deliveries/payouts/");
    expect(body).toMatchObject({ courier: "maystro", courier_payout_ref: "mp-9", amount_received: "53900" });
    expect(body).not.toHaveProperty("expected_amount");
    expect(body).not.toHaveProperty("difference");
  });
});

describe("ConfirmPayoutModal without a courier date", () => {
  beforeEach(() => { get.mockReset(); post.mockReset(); });

  it("shows that the date was not given and sends the pickup date entered", async () => {
    const user = userEvent.setup();
    post.mockResolvedValue({ data: { id: "p2" } });
    withQuery(<ConfirmPayoutModal courier="guepex" courierName="Guepex"
      item={{ courier_payout_ref: "M-5", paid_on: null, count: 2, expected_amount: "7100.00" }} onClose={vi.fn()} />);

    expect(screen.getByText(t("deliveries.payout_no_date", { ref: "M-5" }))).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: t("deliveries.payout_confirm") }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    const body = post.mock.calls[0][1];
    expect(body).toMatchObject({ courier: "guepex", courier_payout_ref: "M-5", amount_received: "7100.00" });
    expect(body.picked_up_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("PayoutsToConfirm", () => {
  beforeEach(() => { get.mockReset(); post.mockReset(); });

  it("confirms the selected payouts in bulk after a confirmation", async () => {
    const user = userEvent.setup();
    post.mockResolvedValue({ data: { created: ["a", "b"], failed: [] } });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const courier = {
      courier: "maystro",
      courier_payouts: [ITEM, { ...ITEM, courier_payout_ref: "mp-8", paid_on: "2026-11-10", expected_amount: "1000.00" }],
      held: null, ready: null,
    };
    withQuery(<PayoutsToConfirm courier={courier} courierName="Maystro" />);

    expect(screen.queryByRole("button", { name: t("deliveries.payout_bulk_button", { count: 2 }) })).not.toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: t("deliveries.payout_select_all") }));
    await user.click(screen.getByRole("button", { name: t("deliveries.payout_bulk_button", { count: 2 }) }));

    expect(confirm).toHaveBeenCalledWith(t("deliveries.payout_bulk_confirm", {
      count: 2, amount: formatMoney("55000.00", i18n.language),
    }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0][0]).toBe("/deliveries/payouts/confirm-courier-payouts/");
    expect(post.mock.calls[0][1]).toMatchObject({ courier: "maystro", refs: ["mp-9", "mp-8"] });
    expect(await screen.findByRole("status")).toHaveTextContent(t("deliveries.payout_bulk_done", { count: 2 }));
    confirm.mockRestore();
  });
});

describe("ManualPayoutModal", () => {
  beforeEach(() => { get.mockReset(); post.mockReset(); });

  it("shows unknown tracking numbers returned by the check", async () => {
    const user = userEvent.setup();
    post.mockRejectedValue(Object.assign(new Error("400"), {
      isAxiosError: true,
      response: { status: 400, data: { error: { message: "Numéros inconnus", details: { unknown_trackings: ["NOPE-1"] } } } },
    }));
    const accounts = [{ id: "acc-1", courier: "maystro", courier_name: "Maystro", last_synced_at: null,
                        last_sync_error: "", syncing: false, by_tracking: false }];
    withQuery(<ManualPayoutModal open accounts={accounts} onClose={vi.fn()} />);

    await user.type(screen.getByLabelText(t("deliveries.payout_step_trackings")), "T1\nNOPE-1");
    await user.click(screen.getByRole("button", { name: t("deliveries.payout_check") }));

    expect(await screen.findByRole("alert")).toHaveTextContent("NOPE-1");
    expect(post.mock.calls[0][1]).toMatchObject({ courier: "maystro", trackings: ["T1", "NOPE-1"], courier_payout_ref: "" });
    expect(screen.queryByLabelText(t("deliveries.payout_amount_counted"))).not.toBeInTheDocument();
  });
});
