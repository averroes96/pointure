import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import "@/lib/i18n";
import { ClientRiskBadge } from "@/components/ClientRiskBadge";

describe("ClientRiskBadge", () => {
  it("renders grade A badge by default", () => {
    render(<ClientRiskBadge grade="A" />);
    expect(screen.getByText(/A/)).toBeInTheDocument();
  });

  it("renders blocked badge when isBlocked is true", () => {
    render(<ClientRiskBadge grade="D" isBlocked={true} />);
    expect(screen.getByText(/Blocked|Bloqué/i)).toBeInTheDocument();
    expect(screen.getByText(/D/)).toBeInTheDocument();
  });

  it("renders compact mode showing only the grade letter", () => {
    render(<ClientRiskBadge grade="B" compact />);
    expect(screen.getByText("B")).toBeInTheDocument();
  });

  it("includes tooltip details when provided", () => {
    const { container } = render(
      <ClientRiskBadge
        grade="C"
        details={{
          grade: "C",
          avg_days_to_pay: 65,
          overdue_amount: "5000.00",
          bounced_cheques_12m: 0,
          last_payment_date: "2026-10-01",
        }}
      />
    );
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.getAttribute("title")).toContain("65");
    expect(wrapper.getAttribute("title")).toContain("5000.00");
  });
});
