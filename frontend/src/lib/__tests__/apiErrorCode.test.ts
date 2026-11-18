import { AxiosError } from "axios";
import { describe, expect, it } from "vitest";
import ar from "@/locales/ar.json";
import en from "@/locales/en.json";
import fr from "@/locales/fr.json";
import { getApiError, getApiErrorCode } from "../api";

function apiError(status: number, data: unknown): AxiosError {
  const error = new AxiosError(`HTTP ${status}`);
  error.response = { status, data, statusText: "", headers: {}, config: {} as never };
  return error;
}

// The scan endpoint's answer when a compiled OCR module cannot be loaded on the PC.
const OCR_UNAVAILABLE = apiError(503, {
  detail: "La lecture automatique (OCR) n'est pas disponible sur ce poste.",
  error: {
    code: "ocr_unavailable",
    message: "La lecture automatique (OCR) n'est pas disponible sur ce poste.",
    hint: "Composant Windows manquant (Microsoft Visual C++ 2015-2022, MSVCP140.dll)",
    status_code: 503,
  },
});

describe("getApiErrorCode", () => {
  it("reads the code of the error envelope", () => {
    expect(getApiErrorCode(OCR_UNAVAILABLE)).toBe("ocr_unavailable");
    expect(getApiErrorCode(apiError(413, { error: { code: "file_too_large", message: "x" } }))).toBe("file_too_large");
  });

  it("returns null when there is no code", () => {
    expect(getApiErrorCode(apiError(400, { detail: "Bad" }))).toBeNull();
    expect(getApiErrorCode(apiError(500, "<html>"))).toBeNull();
    expect(getApiErrorCode(apiError(400, { error: "plan_upgrade_required" }))).toBeNull();
    expect(getApiErrorCode(new AxiosError("Network Error"))).toBeNull();
    expect(getApiErrorCode(new Error("boom"))).toBeNull();
  });

  it("leaves getApiError unchanged for the same answer", () => {
    expect(getApiError(OCR_UNAVAILABLE)).toBe("La lecture automatique (OCR) n'est pas disponible sur ce poste.");
  });
});

describe("scanner.ocr_unavailable", () => {
  it("exists in every locale", () => {
    for (const locale of [fr, en, ar] as Array<{ scanner: Record<string, string> }>) {
      expect(locale.scanner.ocr_unavailable).toBeTruthy();
    }
    expect(ar.scanner.ocr_unavailable).not.toBe(fr.scanner.ocr_unavailable);
  });
});
