import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDebouncedValue } from "../useDebouncedValue";

afterEach(() => vi.useRealTimers());

describe("useDebouncedValue", () => {
  it("returns the first value at once and the latest one only after the pause", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 250), {
      initialProps: { value: "a" },
    });
    expect(result.current).toBe("a");

    rerender({ value: "ab" });
    act(() => { vi.advanceTimersByTime(100); });
    rerender({ value: "abc" });                       // typing continues: the wait restarts
    act(() => { vi.advanceTimersByTime(249); });
    expect(result.current).toBe("a");
    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current).toBe("abc");
  });

  it("never emits the intermediate values", () => {
    vi.useFakeTimers();
    const seen: string[] = [];
    const { rerender } = renderHook(({ value }) => {
      const debounced = useDebouncedValue(value, 250);
      if (seen[seen.length - 1] !== debounced) seen.push(debounced);
      return debounced;
    }, { initialProps: { value: "" } });

    for (const value of ["b", "ba", "bab"]) {
      rerender({ value });
      act(() => { vi.advanceTimersByTime(50); });
    }
    act(() => { vi.advanceTimersByTime(300); });
    expect(seen).toEqual(["", "bab"]);
  });
});
