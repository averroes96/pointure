import axios, { AxiosError, CanceledError } from "axios";
import { describe, expect, it } from "vitest";
import { shouldRetryQuery } from "../queryRetry";

function httpError(status: number): AxiosError {
  const error = new AxiosError(`HTTP ${status}`, "ERR_BAD_REQUEST");
  error.response = { status, data: {}, statusText: "", headers: {}, config: {} as never };
  return error;
}

describe("shouldRetryQuery", () => {
  it.each([400, 401, 403, 404, 405, 409, 422])("does not repeat a %i answer", (status) => {
    expect(shouldRetryQuery(0, httpError(status))).toBe(false);
  });

  it.each([408, 429, 500, 502, 503])("retries a %i answer once", (status) => {
    expect(shouldRetryQuery(0, httpError(status))).toBe(true);
    expect(shouldRetryQuery(1, httpError(status))).toBe(false);
  });

  it("retries once when the request got no answer (offline, server restarting)", () => {
    const offline = new AxiosError("Network Error", "ERR_NETWORK");
    expect(axios.isAxiosError(offline) && offline.response === undefined).toBe(true);
    expect(shouldRetryQuery(0, offline)).toBe(true);
    expect(shouldRetryQuery(1, offline)).toBe(false);
  });

  it("does not retry a cancelled request", () => {
    expect(shouldRetryQuery(0, new CanceledError())).toBe(false);
  });

  it("retries an unexpected error once", () => {
    expect(shouldRetryQuery(0, new Error("boom"))).toBe(true);
    expect(shouldRetryQuery(1, new Error("boom"))).toBe(false);
  });
});
