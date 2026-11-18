import { beforeEach, describe, expect, it, vi } from "vitest";

const { post } = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock("@/lib/api", () => ({ default: { post } }));

import { createSupplierClaim, logDefect, sellDefectAtDiscount, writeOffDefect } from "../defectsApi";

const SUPPLIER = "0285e8f8-ba9d-4882-84ec-a40878296e13";      // starts with digits: parseInt gives 285
const BRANCH = "adce0764-8133-4d90-a95c-3038ef810e29";

describe("defects requests", () => {
  beforeEach(() => {
    post.mockReset();
    post.mockResolvedValue({ data: {} });
  });

  it("writes a defect off through the resolve-write-off route", async () => {
    await writeOffDefect("d-1");
    expect(post).toHaveBeenCalledWith("/inventory/defects/d-1/resolve-write-off/");
  });

  it("sells a defect at a discount through the resolve-discount-sale route", async () => {
    await sellDefectAtDiscount("d-2");
    expect(post).toHaveBeenCalledWith("/inventory/defects/d-2/resolve-discount-sale/");
  });

  it("creates a supplier claim with the keys and the UUID the backend expects", async () => {
    await createSupplierClaim(["d-1", "d-2"], SUPPLIER, "torn leather");
    expect(post).toHaveBeenCalledWith("/inventory/defects/create-supplier-claim/", {
      item_ids: ["d-1", "d-2"],
      supplier_id: SUPPLIER,
      notes: "torn leather",
    });
  });

  it("logs a defect with branch and supplier ids untouched", async () => {
    await logDefect({
      variantId: "v-1", branchId: BRANCH, supplierId: SUPPLIER, defectReason: "torn_leather",
      quantity: 2, costPrice: 2500, notes: "n",
    });
    expect(post).toHaveBeenCalledWith("/inventory/defects/", {
      variant: "v-1", branch: BRANCH, supplier: SUPPLIER, defect_reason: "torn_leather",
      quantity: 2, cost_price: 2500, notes: "n",
    });
  });

  it("sends no supplier and no branch when none is chosen", async () => {
    await logDefect({ variantId: "v-1", branchId: "", supplierId: "", defectReason: "other", quantity: 1, notes: "" });
    expect(post.mock.calls[0][1]).toMatchObject({ branch: undefined, supplier: null });
  });
});
