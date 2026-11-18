import { describe, expect, it } from "vitest";
import { toBulkAdjustments } from "../stockAdjustments";

const STARTS_WITH_DIGITS = "0285e8f8-ba9d-4882-84ec-a40878296e13";   // Number() and parseInt() give NaN / 285
const STARTS_WITH_LETTER = "adce0764-8133-4d90-a95c-3038ef810e29";

describe("toBulkAdjustments", () => {
  it("keeps variant ids exactly as they are", () => {
    expect(toBulkAdjustments({ [STARTS_WITH_DIGITS]: 6, [STARTS_WITH_LETTER]: 3 })).toEqual([
      { variant: STARTS_WITH_DIGITS, quantity_delta: 6 },
      { variant: STARTS_WITH_LETTER, quantity_delta: 3 },
    ]);
  });

  it("drops lines without a positive quantity", () => {
    expect(toBulkAdjustments({ a: 0, b: -2, c: 4, d: Number.NaN })).toEqual([{ variant: "c", quantity_delta: 4 }]);
  });

  it("returns nothing for no quantities", () => {
    expect(toBulkAdjustments({})).toEqual([]);
  });
});
