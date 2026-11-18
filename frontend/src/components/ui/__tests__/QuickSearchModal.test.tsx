import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import axios from "axios";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, default: { get } };
});
vi.mock("@/features/auth/AuthContext", () => ({ useAuth: () => ({ user: { role: "owner" } }) }));
vi.mock("@/features/auth/BranchContext", () => ({ useBranch: () => ({ currentBranch: { id: 7 } }) }));

import QuickSearchModal from "../QuickSearchModal";

const EMPTY = { products: [], clients: [], suppliers: [], invoices: [] };
const PRODUCT = {
  id: 1, name: "Basket Test", reference: "BT-1", brand: "Marque", sale_price: "4500", location: "A1", stock_qty: 3,
};

async function openModal() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter><QuickSearchModal /></MemoryRouter>
    </QueryClientProvider>,
  );
  act(() => { window.dispatchEvent(new Event("app-open-quick-search")); });
  return screen.findByRole("textbox");
}

describe("QuickSearchModal server search", () => {
  beforeEach(() => { get.mockReset(); });   // a block: a returned function would run as a cleanup hook

  it("sends one request for a burst of keystrokes, once typing pauses", async () => {
    get.mockResolvedValue({ data: EMPTY });
    const user = userEvent.setup();
    const input = await openModal();

    await user.type(input, "bab");                    // three keystrokes in a row
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));

    const [url, config] = get.mock.calls[0];
    expect(url).toBe("/core/quick-search/?q=bab&branch_id=7");   // not "ba", not "b"
    expect(config.signal).toBeInstanceOf(AbortSignal);
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("does not search the server for fewer than two characters", async () => {
    const user = userEvent.setup();
    const input = await openModal();
    await user.type(input, "b");
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(get).not.toHaveBeenCalled();
  });

  it("cancels the previous search when a new one starts", async () => {
    get.mockImplementation((_url: string, config: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        config.signal.addEventListener("abort", () => reject(new axios.CanceledError()));
      }),
    );
    const user = userEvent.setup();
    const input = await openModal();

    await user.type(input, "ab");
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    const first: AbortSignal = get.mock.calls[0][1].signal;

    await user.type(input, "c");
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(first.aborted).toBe(true));
    expect(get.mock.calls[1][0]).toBe("/core/quick-search/?q=abc&branch_id=7");
  });

  it("keeps the last results while the next search runs, and drops them when the box is cleared", async () => {
    get.mockResolvedValueOnce({ data: { ...EMPTY, products: [PRODUCT] } });
    get.mockImplementation(() => new Promise(() => {}));            // the next search never answers
    const user = userEvent.setup();
    const input = await openModal();

    await user.type(input, "bas");
    expect(await screen.findByText("Basket Test")).toBeInTheDocument();

    await user.type(input, "k");                                    // next search starts…
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    expect(screen.getByText("Basket Test")).toBeInTheDocument();    // …and the old results stay

    await user.clear(input);
    await waitFor(() => expect(screen.queryByText("Basket Test")).not.toBeInTheDocument());
  });
});
