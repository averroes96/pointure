import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import i18n from "@/lib/i18n";
import type { CourierSyncState } from "../types";

const t = i18n.t.bind(i18n);

const { post } = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, default: { get: vi.fn(), post } };
});

import AddByTracking, { MAX_TRACKINGS } from "../components/AddByTracking";

function withQuery(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const account = (over: Partial<CourierSyncState> = {}): CourierSyncState => ({
  id: "acc-noest", courier: "noest", courier_name: "NOEST", last_synced_at: null, last_sync_error: "",
  syncing: false, by_tracking: true, ...over,
});

describe("AddByTracking", () => {
  beforeEach(() => post.mockReset());

  it("is hidden when no courier needs it", () => {
    const { container } = withQuery(<AddByTracking accounts={[account({ by_tracking: false, courier: "maystro" })]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("sends the parsed trackings for the courier and shows what happened", async () => {
    const user = userEvent.setup();
    post.mockResolvedValue({ data: { added: ["N1", "N2"], already_followed: ["N3"], unknown: ["N404"] } });
    withQuery(<AddByTracking accounts={[account(), account({ id: "acc-m", courier: "maystro", by_tracking: false })]} />);

    await user.click(screen.getByRole("button", { name: t("deliveries.add_by_tracking") }));
    await user.type(screen.getByLabelText(t("deliveries.add_by_tracking_numbers")), " N1\nN2, N3;N1\nN404 ");
    expect(screen.getByText(t("deliveries.add_by_tracking_count", { count: 4 }))).toBeInTheDocument();
    expect(screen.queryByLabelText(t("deliveries.col_courier"))).toBeNull();   // only one eligible courier
    await user.click(screen.getByRole("button", { name: t("deliveries.add_by_tracking_submit") }));

    await waitFor(() => expect(post).toHaveBeenCalledWith("/deliveries/shipments/add-by-tracking/", {
      provider_config: "acc-noest", trackings: ["N1", "N2", "N3", "N404"],
    }));
    expect(await screen.findByText(t("deliveries.add_by_tracking_added", { count: 2 }))).toBeInTheDocument();
    expect(screen.getByText(t("deliveries.add_by_tracking_already", { list: "N3" }))).toBeInTheDocument();
    expect(screen.getByText(t("deliveries.add_by_tracking_unknown", { list: "N404" }))).toBeInTheDocument();
  });

  it("refuses more than the server takes at once, without calling it", async () => {
    const user = userEvent.setup();
    withQuery(<AddByTracking accounts={[account()]} />);
    await user.click(screen.getByRole("button", { name: t("deliveries.add_by_tracking") }));
    const many = Array.from({ length: MAX_TRACKINGS + 1 }, (_, i) => `N${i}`).join(" ");
    await user.click(screen.getByLabelText(t("deliveries.add_by_tracking_numbers")));
    await user.paste(many);
    expect(screen.getByText(t("deliveries.add_by_tracking_too_many", { max: MAX_TRACKINGS }))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("deliveries.add_by_tracking_submit") })).toBeDisabled();
    expect(post).not.toHaveBeenCalled();
  });
});
