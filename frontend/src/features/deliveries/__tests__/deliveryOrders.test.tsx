import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { AxiosError, AxiosHeaders } from "axios";
import i18n from "@/lib/i18n";
import {
  buildOrderPayload, codToCollectCents, emptyForm, expectedCodCents, fromCents, goodsTotalCents,
  readDispatchProblem, tabParams, toCents, validateOrder, type DeliveryOrder, type FormLine, type OrderForm,
} from "../deliveryOrders";

const t = i18n.t.bind(i18n);

const { get, post, patch } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn() }));
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, default: { get, post, patch, delete: vi.fn() } };
});

import DeliveryOrderModal from "../components/DeliveryOrderModal";

function withQuery(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const line = (over: Partial<FormLine> = {}): FormLine => ({
  key: "l1", variant: "v-42", label: "Basket 42", stock: 5, quantity: "2", unit_price: "4500", discount_amount: "500", ...over,
});

const filled = (over: Partial<OrderForm> = {}): OrderForm => ({
  ...emptyForm(),
  customer_name: " Amine ", customer_phone: "0551 23 45 67", wilaya: "16", commune: "Bab Ezzouar",
  shipping_fee: "600", lines: [line(), line({ key: "l2", variant: "v-43", quantity: "1", discount_amount: "0" })],
  ...over,
});

describe("amounts (mirror of the backend helpers)", () => {
  it("parses money in cents", () => {
    expect([toCents("4500"), toCents("4 500,5"), toCents("0.01"), toCents(""), toCents("1.234"), toCents("abc")])
      .toEqual([450000, 450050, 1, null, null, null]);
    expect([fromCents(450050), fromCents(5), fromCents(-150)]).toEqual(["4500.50", "0.05", "-1.50"]);
  });

  it("goods total, expected COD and what the courier collects", () => {
    const form = filled();
    expect(goodsTotalCents(form.lines)).toBe(1300000);
    expect(expectedCodCents(form)).toBe(1360000);
    expect(expectedCodCents({ ...form, free_shipping: true })).toBe(1300000);
    expect(codToCollectCents(form)).toBe(1360000);
    expect(codToCollectCents({ ...form, cod_override: "10000" })).toBe(1000000);
  });
});

describe("validateOrder", () => {
  it("a draft needs a name and a valid phone only", () => {
    expect(validateOrder({ ...emptyForm(), customer_name: "A", customer_phone: "0551234567" }, "draft")).toEqual({});
    expect(validateOrder(emptyForm(), "draft")).toEqual({
      customer_name: "delivery_orders.errors.required", customer_phone: "delivery_orders.errors.phone",
    });
  });

  it("sending needs a destination, articles and a desk for stop-desk orders", () => {
    const base = { ...emptyForm(), customer_name: "A", customer_phone: "0551234567", delivery_type: "stopdesk" as const };
    expect(validateOrder(base, "send")).toEqual({
      wilaya: "delivery_orders.errors.required", commune: "delivery_orders.errors.required",
      lines: "delivery_orders.errors.no_lines", stop_desk_id: "delivery_orders.errors.desk",
    });
    expect(validateOrder(filled(), "send")).toEqual({});
  });

  it("checks lines, the second phone and the COD like the server", () => {
    const errors = validateOrder(filled({
      customer_phone2: "0991234567",
      lines: [line({ key: "a", quantity: "0" }), line({ key: "b", unit_price: "x" }), line({ key: "c", discount_amount: "9001" })],
    }), "send");
    expect(errors).toEqual({
      customer_phone2: "delivery_orders.errors.phone",
      "line.a": "delivery_orders.errors.quantity", "line.b": "delivery_orders.errors.price",
      "line.c": "delivery_orders.errors.discount",
    });
    expect(validateOrder(filled({ cod_override: "13600.50" }), "send").cod_override).toBe("delivery_orders.errors.cod_whole");
    expect(validateOrder(filled({ cod_override: "13601" }), "send").cod_override).toBe("delivery_orders.errors.cod_too_high");
    expect(validateOrder(filled({ cod_override: "13600" }), "send")).toEqual({});
  });
});

describe("buildOrderPayload", () => {
  it("sends lines and options, never totals", () => {
    const body = buildOrderPayload(filled(), true);
    expect(body).toEqual({
      customer_name: "Amine", customer_phone: "0551 23 45 67", customer_phone2: "", wilaya: "16",
      commune: "Bab Ezzouar", address: "", customer_notes: "", delivery_type: "home", stop_desk_id: "",
      stop_desk_name: "", shipping_fee: "600.00", quoted_fee: null, free_shipping: false, open_package: false,
      note_to_driver: "", cod_amount: null, source: "manual",
      lines: [
        { variant: "v-42", quantity: 2, unit_price: "4500.00", discount_amount: "500.00" },
        { variant: "v-43", quantity: 1, unit_price: "4500.00", discount_amount: "0.00" },
      ],
    });
    for (const key of ["goods_total", "expected_cod", "cod_to_collect", "status", "tracking_number"]) {
      expect(body).not.toHaveProperty(key);
    }
  });

  it("keeps the desk only for stop-desk orders and sends a typed COD", () => {
    const desk = buildOrderPayload(filled({
      delivery_type: "stopdesk", stop_desk_id: "D1", stop_desk_name: "Bureau", cod_override: "10 000", quoted_fee: "550",
    }), false);
    expect([desk.stop_desk_id, desk.stop_desk_name, desk.cod_amount, desk.quoted_fee]).toEqual(["D1", "Bureau", "10000.00", "550.00"]);
    expect(desk).not.toHaveProperty("source");
    const home = buildOrderPayload(filled({ stop_desk_id: "D1", stop_desk_name: "Bureau" }), false);
    expect([home.stop_desk_id, home.stop_desk_name]).toEqual(["", ""]);
  });
});

describe("other helpers", () => {
  it("tab filters", () => {
    expect(tabParams("all", 1)).toEqual({});
    expect(tabParams("in_progress", 2)).toEqual({ status: "confirmed,dispatched", page: "2" });
    expect(tabParams("returned", 1)).toEqual({ status: "returned,rejected" });
    expect(tabParams("attention", 1)).toEqual({ attention: "true" });
  });

  it("reads the courier's refusal reason", () => {
    expect(readDispatchProblem(refusal("Doublon 24 h"))).toEqual({ code: "courier_refused", courierMessage: "Doublon 24 h" });
    expect(readDispatchProblem(new Error("x"))).toEqual({ code: "", courierMessage: "" });
  });
});

// ─── The dialog ───────────────────────────────────────────────────────────────

function refusal(courierMessage: string) {
  const headers = new AxiosHeaders();
  return new AxiosError("bad gateway", "ERR_BAD_RESPONSE", undefined, undefined, {
    status: 502, statusText: "Bad Gateway", headers, config: { headers },
    data: { error: { code: "courier_refused", message: "Le transporteur a refusé la commande.",
                     details: { message: "Le transporteur a refusé la commande.", courier_message: courierMessage },
                     status_code: 502 } },
  });
}

const ORDER: DeliveryOrder = {
  id: "o-1", source: "manual", customer_name: "Amine", customer_phone: "0551234567", customer_phone2: "",
  wilaya: "16", commune: "Bab-Ezzouar", address: "", customer_notes: "", delivery_type: "home",
  stop_desk_id: "", stop_desk_name: "", shipping_fee: "600.00", quoted_fee: null, free_shipping: false,
  open_package: false, note_to_driver: "", cod_amount: null,
  lines: [{ id: "l-1", variant: "v-42", variant_label: "Basket EU42", quantity: 2, unit_price: "4500.00",
            discount_amount: "0.00", subtotal: "9000.00" }],
  goods_total: "9000.00", expected_cod: "9600.00", cod_to_collect: "9600.00", status: "draft", provider: null,
  tracking_number: null, sale: null, sale_receipt: null, shipment: null, attention: "", dispatched_at: null,
  created_at: "2026-11-17T10:00:00Z",
};

describe("DeliveryOrderModal", () => {
  beforeEach(() => {
    get.mockReset(); post.mockReset(); patch.mockReset();
    get.mockImplementation(async (url: string) => {
      if (url === "/deliveries/provider-configs/") {
        return { data: [{ id: "acc-1", courier: "maystro", courier_name: "Maystro", is_active: true, missing_credentials: [] }] };
      }
      if (url === "/core/wilayas/") return { data: [{ id: 16, code: "16", name: "Alger", ar_name: "الجزائر" }] };
      if (url === "/deliveries/communes/") {
        return { data: { wilaya: 16, ship_wilaya: 16, available: true, refreshing: false,
                         courier_communes: [{ name_fr: "Bab Ezzouar", name_ar: "باب الزوار" }],
                         match: { name_fr: "Bab Ezzouar", name_ar: "باب الزوار" } } };
      }
      if (url.endsWith("/rates/")) {
        return { data: { delivery_fee: "550.00", return_fee: null, cod_fee: null, total: "550.00", currency: "DZD",
                         delivery_type: "home", estimated_days: 2 } };
      }
      throw new Error(`unexpected GET ${url}`);
    });
    patch.mockImplementation(async (_url: string, body: Record<string, unknown>) => ({ data: { ...ORDER, ...body } }));
  });

  it("saves the courier spelling, then sends with the chosen account", async () => {
    const onDone = vi.fn();
    post.mockResolvedValue({ data: { trackingNumber: "MAY-1" } });
    withQuery(<DeliveryOrderModal order={ORDER} onClose={vi.fn()} onDone={onDone} />);

    // The quote (550) differs from the store's fee (600): the form offers it, without replacing it.
    await screen.findByRole("button", { name: t("delivery_orders.use_quote") });
    await userEvent.click(screen.getByRole("button", { name: t("delivery_orders.send") }));

    await waitFor(() => expect(onDone).toHaveBeenCalledWith(t("delivery_orders.sent", { tracking: "MAY-1" })));
    const [url, body] = patch.mock.calls[0];
    expect(url).toBe("/deliveries/customer-orders/o-1/");
    expect(body.commune).toBe("Bab Ezzouar");          // matched to the courier's spelling
    expect(body.shipping_fee).toBe("600.00");          // the store's fee is kept, not replaced by the quote
    expect(body.quoted_fee).toBe("550.00");
    expect(body).not.toHaveProperty("goods_total");
    expect(post).toHaveBeenCalledWith("/deliveries/customer-orders/o-1/dispatch_order/", { provider_config: "acc-1" });
  });

  it("shows the courier's reason when it refuses", async () => {
    post.mockRejectedValue(refusal("Une commande existe déjà pour ce client (24 h)"));
    const onDone = vi.fn();
    withQuery(<DeliveryOrderModal order={ORDER} onClose={vi.fn()} onDone={onDone} />);

    await screen.findAllByRole("option", { name: /Bab Ezzouar/ });
    await userEvent.click(screen.getByRole("button", { name: t("delivery_orders.send") }));

    expect(await screen.findByText("Le transporteur a refusé la commande.")).toBeTruthy();
    expect(screen.getByText(t("delivery_orders.courier_said", { message: "Une commande existe déjà pour ce client (24 h)" })))
      .toBeTruthy();
    expect(onDone).not.toHaveBeenCalled();
  });

  it("does not call the server when the form is incomplete", async () => {
    withQuery(<DeliveryOrderModal order={null} onClose={vi.fn()} onDone={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: t("delivery_orders.send") }));
    expect(screen.getAllByText(t("delivery_orders.errors.required")).length).toBeGreaterThan(0);
    expect(screen.getByText(t("delivery_orders.errors.no_lines"))).toBeTruthy();
    expect(patch).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });
});
