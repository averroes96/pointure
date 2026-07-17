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
