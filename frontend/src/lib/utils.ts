import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge Tailwind classes, handling conflicts */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Generate a WhatsApp link with pre-filled message */
export function whatsappLink(phone: string, message: string): string {
  const cleaned = phone.replace(/\D/g, "");
  const encoded = encodeURIComponent(message);
  return `https://wa.me/${cleaned}?text=${encoded}`;
}

/** Debounce function */
export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout>;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

/** Capitalize first letter */
export function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

/** Get status badge class */
export function getStatusBadgeClass(status: string): string {
  const map: Record<string, string> = {
    paid: "badge-success",
    completed: "badge-success",
    received: "badge-success",
    deposited: "badge-success",
    sent: "badge-info",
    pending: "badge-info",
    partial: "badge-warning",
    in_transit: "badge-warning",
    overdue: "badge-danger",
    bounced: "badge-danger",
    refunded: "badge-warning",
    partially_paid: "badge-warning",
    layaway: "bg-indigo-100 text-indigo-800 border-indigo-200",
    in_progress: "bg-blue-100 text-blue-800 border-blue-200",
    paused: "bg-amber-100 text-amber-800 border-amber-200",
    cancelled: "badge-neutral",
    draft: "badge-neutral",
  };
  return map[status] ?? "badge-neutral";
}

/** Truncate string */
export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + "…";
}

/**
 * Renders the translated "N/A" if colour is "N/A", otherwise the colour itself.
 */
export function formatColour(colour: string | null | undefined, t: any): string {
  if (!colour) return "";
  if (colour === "N/A") return t("common.na");
  return colour;
}

const AZERTY_DIGIT_MAP: Record<string, string> = {
  "&": "1",
  "é": "2",
  '"': "3",
  "'": "4",
  "(": "5",
  "-": "6",
  "è": "7",
  "_": "8",
  "ç": "9",
  "à": "0",
};

/**
 * Normalizes a numeric / decimal string from either standard digits (0-9)
 * or unshifted French AZERTY top-row keys (&é"'(-è_çà), converting commas to dots.
 */
export function normalizeNumericInput(raw: string): string {
  let out = "";
  let hasDecimal = false;
  for (const ch of raw) {
    if (ch >= "0" && ch <= "9") {
      out += ch;
    } else if (AZERTY_DIGIT_MAP[ch] !== undefined) {
      out += AZERTY_DIGIT_MAP[ch];
    } else if ((ch === "." || ch === ",") && !hasDecimal) {
      out += ".";
      hasDecimal = true;
    }
  }
  return out;
}

/**
 * Extracts a digit ('0'-'9') from a KeyboardEvent, supporting Numpad, standard digits,
 * and unshifted French AZERTY top-row keys (Digit0..Digit9).
 */
export function extractDigitFromKeyEvent(e: { key: string; code?: string }): string | null {
  if (/^[0-9]$/.test(e.key)) return e.key;
  if (e.code && /^Digit[0-9]$/.test(e.code)) return e.code.slice(5);
  if (e.code && /^Numpad[0-9]$/.test(e.code)) return e.code.slice(6);
  if (AZERTY_DIGIT_MAP[e.key] !== undefined) return AZERTY_DIGIT_MAP[e.key];
  return null;
}

