import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequestQueue } from "../requestQueue";

function deferred<T = string>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => vi.useRealTimers());

describe("createRequestQueue", () => {
  it("runs one request at a time and starts the next when the first finishes", async () => {
    const queue = createRequestQueue(1);
    const started: string[] = [];
    const a = deferred();
    const b = deferred();
    const pa = queue.enqueue(() => { started.push("a"); return a.promise; });
    const pb = queue.enqueue(() => { started.push("b"); return b.promise; });

    await tick();
    expect(started).toEqual(["a"]);
    a.resolve("A");
    expect(await pa).toBe("A");
    await tick();
    expect(started).toEqual(["a", "b"]);
    b.resolve("B");
    expect(await pb).toBe("B");
  });

  it("orders what was queued in the same tick by priority, then arrival", async () => {
    const queue = createRequestQueue(1);
    const order: string[] = [];
    const run = (name: string) => () => { order.push(name); return Promise.resolve(name); };

    await Promise.all([
      queue.enqueue(run("hint"), { priority: 3 }),       // queued first, least important
      queue.enqueue(run("kpis-1"), { priority: 0 }),
      queue.enqueue(run("chart"), { priority: 1 }),
      queue.enqueue(run("kpis-2"), { priority: 0 }),
    ]);
    expect(order).toEqual(["kpis-1", "kpis-2", "chart", "hint"]);
  });

  it("allows the configured number at once", async () => {
    const queue = createRequestQueue(2);
    const started: string[] = [];
    const gate = deferred();
    const work = (name: string) => () => { started.push(name); return gate.promise; };
    const all = Promise.all(["a", "b", "c"].map((name) => queue.enqueue(work(name))));
    await tick();
    expect(started).toEqual(["a", "b"]);
    gate.resolve("done");
    await all;
    expect(started).toEqual(["a", "b", "c"]);
  });

  it("drops an aborted request that is still waiting, and runs the rest", async () => {
    const queue = createRequestQueue(1);
    const started: string[] = [];
    const first = deferred();
    const controller = new AbortController();
    const p1 = queue.enqueue(() => first.promise);
    const p2 = queue.enqueue(() => { started.push("aborted"); return Promise.resolve("x"); }, { signal: controller.signal });
    const p3 = queue.enqueue(() => { started.push("c"); return Promise.resolve("C"); });
    await tick();

    controller.abort();
    await expect(p2).rejects.toMatchObject({ name: "AbortError" });
    first.resolve("A");
    await p1;
    expect(await p3).toBe("C");
    expect(started).toEqual(["c"]);
  });

  it("rejects at once, without running, a request that was already aborted", async () => {
    const queue = createRequestQueue(1);
    const run = vi.fn(() => Promise.resolve("x"));
    const controller = new AbortController();
    controller.abort();
    await expect(queue.enqueue(run, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(run).not.toHaveBeenCalled();
  });

  it("hands the signal to a request when it starts", async () => {
    const queue = createRequestQueue(1);
    const controller = new AbortController();
    let seen: AbortSignal | undefined;
    await queue.enqueue((signal) => { seen = signal; return Promise.resolve(1); }, { signal: controller.signal });
    expect(seen).toBe(controller.signal);
  });

  it("keeps going after a failed request", async () => {
    const queue = createRequestQueue(1);
    const failing = queue.enqueue(() => Promise.reject(new Error("boom")));
    const next = queue.enqueue(() => Promise.resolve("ok"));
    await expect(failing).rejects.toThrow("boom");
    expect(await next).toBe("ok");
  });

  it("does not let a hung request block the others for ever", async () => {
    vi.useFakeTimers();
    const queue = createRequestQueue(1, 1000);
    const started: string[] = [];
    const hung = deferred();
    const p1 = queue.enqueue(() => { started.push("hung"); return hung.promise; });
    const p2 = queue.enqueue(() => { started.push("next"); return Promise.resolve("N"); });

    await vi.advanceTimersByTimeAsync(0);
    expect(started).toEqual(["hung"]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(started).toEqual(["hung", "next"]);
    expect(await p2).toBe("N");

    hung.resolve("late");                    // its own result is still delivered
    expect(await p1).toBe("late");
  });
});
