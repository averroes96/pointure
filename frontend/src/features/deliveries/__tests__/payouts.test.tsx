import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import i18n from "@/lib/i18n";
import { differenceTone, parseTrackings, payoutDifference } from "../payouts";

const t = i18n.t.bind(i18n);

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, default: { get, post } };
});

import RecordPayoutModal from "../components/RecordPayoutModal";

describe("parseTrackings", () => {
  it("splits on lines, spaces, commas and semicolons, trims and de-duplicates", () => {
    expect(parseTrackings(" T1\nT2, T3;T1\r\n\n  T4 ")).toEqual(["T1", "T2", "T3", "T4"]);
    expect(parseTrackings("   ")).toEqual([]);
  });
});

describe("payoutDifference", () => {
  it("computes received − expected in cents", () => {
    expect(payoutDifference("7000", "7150.00")).toBe("-150.00");
    expect(payoutDifference("0,10", "0.20")).toBe("-0.10");
    expect(payoutDifference("100.10", "100.10")).toBe("0.00");
    expect(payoutDifference("abc", "1")).toBe("");
  });

  it("colours: exact green, short red, over amber", () => {
    expect([differenceTone("0.00"), differenceTone("-1.00"), differenceTone("5.00"), differenceTone("")]).toEqual(
      ["success", "danger", "warning", "neutral"],
    );
  });
});

describe("RecordPayoutModal", () => {
  const accounts = [{ courier: "maystro", courier_name: "Maystro", last_synced_at: null, last_sync_error: "", syncing: false }];

  beforeEach(() => {
    get.mockReset();
    post.mockReset();
    get.mockResolvedValue({
      data: {
        couriers: [{
          courier: "maystro",
          courier_payouts: [{ courier_payout_ref: "mp-9", paid_on: "2026-11-16", count: 12, expected_amount: "54000.00" }],
          held: { count: 3, expected_amount: "13500.00" },
          ready: null,
        }],
      },
    });
  });

  function renderModal(onRecorded = vi.fn()) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <RecordPayoutModal open accounts={accounts} onClose={vi.fn()} onRecorded={onRecorded} />
      </QueryClientProvider>,
    );
    return onRecorded;
  }

  it("records a courier payout with the counted amount and never sends totals", async () => {
    const user = userEvent.setup();
    post.mockImplementation(async (url: string) =>
      url.endsWith("/preview/")
        ? { data: { courier: "maystro", count: 12, expected_amount: "54000.00", shipment_ids: [], trackings: [] } }
        : { data: { id: "p1" } },
    );
    const onRecorded = renderModal();

    const choice = await screen.findByRole("button", { pressed: false, name: /54/ });
    await user.click(choice);
    await user.click(screen.getByRole("button", { name: t("deliveries.payout_check") }));

    const amount = await screen.findByLabelText(t("deliveries.payout_amount_counted"));
    expect(amount).toHaveValue("54000.00");                // prefilled with the expected amount
    await user.clear(amount);
    await user.type(amount, "53900");
    await user.click(screen.getByRole("button", { name: t("deliveries.payout_confirm") }));

    await waitFor(() => expect(onRecorded).toHaveBeenCalled());
    const [url, body] = post.mock.calls[post.mock.calls.length - 1];
    expect(url).toBe("/deliveries/payouts/");
    expect(body).toMatchObject({ courier: "maystro", courier_payout_ref: "mp-9", trackings: [], amount_received: "53900" });
    expect(body).not.toHaveProperty("expected_amount");
    expect(body).not.toHaveProperty("difference");
  });

  it("shows unknown tracking numbers returned by the check", async () => {
    const user = userEvent.setup();
    post.mockRejectedValue(Object.assign(new Error("400"), {
      isAxiosError: true,
      response: { status: 400, data: { error: { message: "Numéros inconnus", details: { unknown_trackings: ["NOPE-1"] } } } },
    }));
    renderModal();

    await user.type(screen.getByLabelText(t("deliveries.payout_step_trackings")), "T1\nNOPE-1");
    await user.click(screen.getByRole("button", { name: t("deliveries.payout_check") }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("NOPE-1");
    expect(screen.queryByLabelText(t("deliveries.payout_amount_counted"))).not.toBeInTheDocument();
  });
});
