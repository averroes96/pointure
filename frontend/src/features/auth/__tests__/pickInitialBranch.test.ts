import { describe, expect, it } from "vitest";
import type { Branch } from "@/types";
import { pickInitialBranch } from "../BranchContext";

// Branch ids are UUID strings at run time (the Branch type says number).
function branch(id: string, extra: Partial<Branch> = {}): Branch {
  return { id, name: `Branch ${id.slice(0, 4)}`, is_headquarters: false, is_active: true, ...extra } as unknown as Branch;
}

const HQ = branch("adce0764-8133-4d90-a95c-3038ef810e29", { is_headquarters: true });
const SECOND = branch("0285e8f8-ba9d-4882-84ec-a40878296e13");      // starts with digits, as parseInt() found out
const THIRD = branch("7c1f0d52-1b0c-4a55-9c1e-2f5b8a6e9d10");

describe("pickInitialBranch", () => {
  it("restores the saved branch", () => {
    expect(pickInitialBranch([HQ, SECOND, THIRD], String(SECOND.id))).toBe(SECOND);
    expect(pickInitialBranch([HQ, SECOND, THIRD], String(THIRD.id))).toBe(THIRD);
  });

  it("falls back to the headquarters when nothing is saved", () => {
    expect(pickInitialBranch([SECOND, HQ, THIRD], null)).toBe(HQ);
  });

  it("falls back to the headquarters when the saved branch no longer exists", () => {
    expect(pickInitialBranch([SECOND, HQ], "deleted-branch-id")).toBe(HQ);
  });

  it("falls back to the first branch when none is a headquarters", () => {
    expect(pickInitialBranch([SECOND, THIRD], null)).toBe(SECOND);
  });

  it("returns null without branches", () => {
    expect(pickInitialBranch([], String(HQ.id))).toBeNull();
  });
});
