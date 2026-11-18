/**
 * Runs heavy read requests one at a time, most important first.
 *
 * Why: on the stores' PCs (about 2 cores, 4 GB) the server is effectively single-lane. The
 * dashboard fired four report requests at once, each ran slower because of the others
 * (1.5 s alone, 2-3 s together) and the first useful number appeared only when the slowest
 * finished. Queued, the most important one finishes first and the rest never compete with
 * it, or with a sale being rung up.
 */

export interface QueueOptions {
  /** Lower runs first. Requests queued in the same tick are ordered by it; ties keep arrival order. */
  priority?: number;
  /** Aborting drops the request if it is still waiting, and is passed on to `run` once it starts. */
  signal?: AbortSignal;
}

export interface RequestQueue {
  enqueue<T>(run: (signal?: AbortSignal) => Promise<T>, options?: QueueOptions): Promise<T>;
}

interface Job {
  priority: number;
  seq: number;
  execute: () => Promise<void>;
}

const DEFAULT_PRIORITY = 5;
/** A request that hangs must not block the others for ever: after this, its slot is released. */
const DEFAULT_MAX_HOLD_MS = 30_000;

const abortError = () => new DOMException("The request was aborted", "AbortError");

export function createRequestQueue(concurrency = 1, maxHoldMs = DEFAULT_MAX_HOLD_MS): RequestQueue {
  const waiting: Job[] = [];
  let running = 0;
  let counter = 0;

  const pump = () => {
    while (running < concurrency && waiting.length > 0) {
      let best = 0;
      for (let i = 1; i < waiting.length; i++) {
        const a = waiting[i];
        const b = waiting[best];
        if (a.priority < b.priority || (a.priority === b.priority && a.seq < b.seq)) best = i;
      }
      const [job] = waiting.splice(best, 1);
      running += 1;

      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        clearTimeout(holdTimer);
        running -= 1;
        pump();
      };
      const holdTimer = setTimeout(release, maxHoldMs);
      void job.execute().finally(release);
    }
  };

  function enqueue<T>(run: (signal?: AbortSignal) => Promise<T>, options: QueueOptions = {}): Promise<T> {
    const { priority = DEFAULT_PRIORITY, signal } = options;
    return new Promise<T>((resolve, reject) => {
      if (signal?.aborted) {
        reject(abortError());
        return;
      }

      const onAbort = () => {
        const index = waiting.indexOf(job);
        if (index >= 0) {
          waiting.splice(index, 1);
          reject(abortError());
        }
      };
      const job: Job = {
        priority,
        seq: counter++,
        execute: async () => {
          signal?.removeEventListener("abort", onAbort);
          try {
            resolve(await run(signal));
          } catch (error) {
            reject(error);
          }
        },
      };

      signal?.addEventListener("abort", onAbort, { once: true });
      waiting.push(job);
      // Start on a microtask, so everything queued in the same tick is ordered by priority.
      queueMicrotask(pump);
    });
  }

  return { enqueue };
}
