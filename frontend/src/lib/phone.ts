/**
 * ShoeDZ — Algerian Phone Validation & Normalization for Frontend.
 *
 * Supports mobile networks (Mobilis 06, Djezzy 07, Ooredoo 05) and landlines (02, 03, 04)
 * with local (05...) or international (+213 / 00213) input formats.
 */

export function cleanPhoneInput(rawPhone?: string | null): string {
  if (!rawPhone) return "";
  return rawPhone.replace(/[\s\-\.\(\)\/\\]+/g, "").trim();
}

export function normalizeAlgerianPhone(rawPhone?: string | null): string {
  let cleaned = cleanPhoneInput(rawPhone);
  if (!cleaned) return "";

  if (cleaned.startsWith("+")) {
    cleaned = cleaned.slice(1);
  }

  if (cleaned.startsWith("00213")) {
    cleaned = cleaned.slice(5);
  } else if (cleaned.startsWith("213") && [11, 12, 13].includes(cleaned.length)) {
    cleaned = cleaned.slice(3);
  }

  if (cleaned.startsWith("0")) {
    return cleaned;
  }

  if (cleaned.length === 9 && ["5", "6", "7"].includes(cleaned[0])) {
    return "0" + cleaned;
  }

  if ([8, 9].includes(cleaned.length) && ["2", "3", "4"].includes(cleaned[0])) {
    return "0" + cleaned;
  }

  return cleaned;
}

export function isValidAlgerianPhone(phone?: string | null, mobileOnly: boolean = false): boolean {
  const normalized = normalizeAlgerianPhone(phone);
  if (!normalized) return false;

  if (mobileOnly) {
    return /^0[567]\d{8}$/.test(normalized);
  }
  return /^0([567]\d{8}|[234]\d{7,8})$/.test(normalized);
}

export function formatAlgerianPhoneDisplay(phone?: string | null): string {
  const normalized = normalizeAlgerianPhone(phone);
  if (!normalized) return phone || "";

  if (normalized.length === 10) {
    // 0555 12 34 56
    return `${normalized.slice(0, 4)} ${normalized.slice(4, 6)} ${normalized.slice(6, 8)} ${normalized.slice(8, 10)}`;
  }
  if (normalized.length === 9) {
    // 021 23 45 67
    return `${normalized.slice(0, 3)} ${normalized.slice(3, 5)} ${normalized.slice(5, 7)} ${normalized.slice(7, 9)}`;
  }
  return normalized;
}

