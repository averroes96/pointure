import { describe, it, expect } from "vitest";
import { escapeHtml } from "../utils";
import { generateReceiptHtml } from "../receipt";
import { generateBonVersementHtml, generateBonReservationHtml } from "../versement";
import { generateChequeDepositSlipHtml } from "@/features/clients/ChequePage";
import { generateLoyaltyCardHtml } from "@/features/loyalty/LoyaltyPage";
import { generateVarianceReportHtml } from "@/features/inventory/StocktakePage";
import type { Sale, StocktakeSession, Cheque, LoyaltyAccountSummary } from "@/types";

describe("HTML escaping for printed documents (Task 3.5)", () => {
  describe("escapeHtml utility", () => {
    it("escapes all special HTML characters", () => {
      const payload = `<img src="x" onerror='alert(1)'> & "test"`;
      const escaped = escapeHtml(payload);
      expect(escaped).toBe(
        `&lt;img src=&quot;x&quot; onerror=&#39;alert(1)&#39;&gt; &amp; &quot;test&quot;`
      );
    });

    it("handles null and undefined gracefully", () => {
      expect(escapeHtml(null as unknown as string)).toBe("");
      expect(escapeHtml(undefined as unknown as string)).toBe("");
      expect(escapeHtml("")).toBe("");
    });
  });

  describe("generateReceiptHtml", () => {
    const maliciousPayload = `<img src=x onerror=alert(1)>`;

    const sampleSale = {
      id: 101,
      receipt_number: "REC-2026-0001",
      created_at: "2026-11-05T12:00:00Z",
      status: "completed",
      is_formal: false,
      total_amount: "4500.00",
      amount_paid: "4500.00",
      balance_due: "0.00",
      cashier_name: `Caissier <script>alert("cashier")</script>`,
      client_name: `Client <script>alert("client")</script>`,
      items: [
        {
          id: 1,
          variant: 10,
          variant_str: `Basket Sport 42 ${maliciousPayload}`,
          quantity: 1,
          unit_price: "4500.00",
          subtotal: "4500.00",
        },
      ],
      payments: [
        {
          id: 1,
          method: "cash" as const,
          amount: "4500.00",
          recorded_at: "2026-11-05T12:00:00Z",
        },
      ],
    } as unknown as Sale;

    it("renders malicious product name as escaped text, never as raw HTML", () => {
      const html = generateReceiptHtml(
        sampleSale,
        `Store <b onmouseover=alert(1)>Name</b>`
      );

      // Must NOT contain unescaped payload
      expect(html).not.toContain(maliciousPayload);
      expect(html).not.toContain(`<script>alert("cashier")</script>`);
      expect(html).not.toContain(`<script>alert("client")</script>`);
      expect(html).not.toContain(`<b onmouseover=alert(1)>Name</b>`);

      // MUST contain escaped entities
      expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
      expect(html).toContain("&lt;script&gt;alert(&quot;cashier&quot;)&lt;/script&gt;");
      expect(html).toContain("&lt;script&gt;alert(&quot;client&quot;)&lt;/script&gt;");
      expect(html).toContain("&lt;b onmouseover=alert(1)&gt;Name&lt;/b&gt;");
    });
  });

  describe("generateBonVersementHtml and generateBonReservationHtml", () => {
    const maliciousPayload = `<img src=x onerror=alert(1)>`;
    const versementSale = {
      id: 102,
      receipt_number: "VER-2026-0002",
      created_at: "2026-11-05T12:00:00Z",
      status: "partially_paid",
      total_amount: "10000.00",
      amount_paid: "4000.00",
      balance_due: "6000.00",
      client_name: `Client ${maliciousPayload}`,
      cashier_name: `Cashier ${maliciousPayload}`,
      notes: `Note ${maliciousPayload}`,
      items: [
        {
          id: 2,
          variant: 12,
          variant_str: `Mocassin Cuir 41 ${maliciousPayload}`,
          quantity: 2,
          unit_price: "5000.00",
          subtotal: "10000.00",
        },
      ],
      payments: [
        {
          id: 2,
          method: "cash" as const,
          amount: "4000.00",
          recorded_at: "2026-11-05T12:00:00Z",
        },
      ],
    } as unknown as Sale;

    it("escapes fields in Bon de Versement", () => {
      const html = generateBonVersementHtml(versementSale, `Store & Boutique`);
      expect(html).not.toContain(maliciousPayload);
      expect(html).not.toContain(`Store & Boutique`);
      expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
      expect(html).toContain("Store &amp; Boutique");
    });

    it("escapes fields in Bon de Reservation", () => {
      const html = generateBonReservationHtml(versementSale, `Store & Boutique`);
      expect(html).not.toContain(maliciousPayload);
      expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
      expect(html).toContain("Store &amp; Boutique");
    });
  });

  describe("generateChequeDepositSlipHtml", () => {
    it("escapes cheque attributes and store name", () => {
      const maliciousPayload = `<img src=x onerror=alert(1)>`;
      const cheques = [
        {
          id: 1,
          number: `CHQ-999 ${maliciousPayload}`,
          bank: `Banque ${maliciousPayload}`,
          client_name: `Client ${maliciousPayload}`,
          amount: "15000.00",
          direction: "receivable" as const,
          status: "pending" as const,
          due_date: "2026-12-01",
          created_at: "2026-11-05",
        },
      ] as unknown as Cheque[];

      const html = generateChequeDepositSlipHtml(cheques, `Store & Sons`);
      expect(html).not.toContain(maliciousPayload);
      expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
      expect(html).toContain("Store &amp; Sons");
    });
  });

  describe("generateLoyaltyCardHtml", () => {
    it("escapes client name, phone and store name", () => {
      const maliciousPayload = `<img src=x onerror=alert(1)>`;
      const account = {
        client: 1,
        client_name: `VIP ${maliciousPayload}`,
        client_phone: `0550123456 ${maliciousPayload}`,
        tier: "gold" as const,
        points_balance: 500,
        total_earned: 1200,
      } as unknown as LoyaltyAccountSummary;

      const html = generateLoyaltyCardHtml(account, null, `Store <b>Fashion</b>`);
      expect(html).not.toContain(maliciousPayload);
      expect(html).not.toContain(`Store <b>Fashion</b>`);
      expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
      expect(html).toContain("Store &lt;b&gt;Fashion&lt;/b&gt;");
    });
  });

  describe("generateVarianceReportHtml", () => {
    it("escapes session title, product details, notes and store name", () => {
      const maliciousPayload = `<img src=x onerror=alert(1)>`;
      const session = {
        id: 1,
        title: `Inventaire ${maliciousPayload}`,
        status: "in_progress",
        status_display: "En cours",
        created_at: "2026-11-05T10:00:00Z",
        total_expected: 10,
        total_counted: 8,
        total_variance: -2,
        total_variance_cost: "-3000.00",
        items: [
          {
            id: 1,
            variant: 10,
            product_name: `Chaussure ${maliciousPayload}`,
            product_reference: `REF-${maliciousPayload}`,
            size_eu: 42,
            colour: `Noir ${maliciousPayload}`,
            barcode: `1234567890123`,
            expected_qty: 5,
            counted_qty: 3,
            unit_cost: "1500.00",
            notes: `Perte ${maliciousPayload}`,
          },
        ],
      } as unknown as StocktakeSession;

      const html = generateVarianceReportHtml(session, `Store & Co`, (k, def) => def);
      expect(html).not.toContain(maliciousPayload);
      expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
      expect(html).toContain("Store &amp; Co");
    });
  });
});
