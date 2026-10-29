/**
 * Centralized Enum & Printable Document Localization Helper (FR / AR / EN).
 * Ensures every product category, gender, season, payment method, sale status,
 * stock movement reason, cheque status, loyalty tier, and printable receipt label
 * is localized consistently across UI tables and thermal/A4 printouts.
 */
import i18n from "@/lib/i18n";
import { getPrinterConfig } from "@/lib/printerConfig";

export type SupportedLang = "fr" | "ar" | "en";

export function getActiveUiLang(): SupportedLang {
  const raw = (i18n?.language || localStorage.getItem("i18nextLng") || "fr").toLowerCase();
  if (raw.startsWith("ar")) return "ar";
  if (raw.startsWith("en")) return "en";
  return "fr";
}

export function getEffectivePrintLang(): "fr" | "ar" | "en" | "bilingual" {
  const cfg = getPrinterConfig();
  const pref = cfg.ticket.printLanguage || "ui";
  if (pref === "ui") return getActiveUiLang();
  return pref;
}

const CATEGORY_MAP: Record<string, Record<SupportedLang, string>> = {
  sneakers: { fr: "Baskets", ar: "أحذية رياضية", en: "Sneakers" },
  boots: { fr: "Bottes", ar: "أحذية شتوية (بوت)", en: "Boots" },
  sandals: { fr: "Sandales", ar: "صنادل", en: "Sandals" },
  heels: { fr: "Talons", ar: "كعب عالي", en: "Heels" },
  loafers: { fr: "Mocassins", ar: "موكاسان", en: "Loafers" },
  sport: { fr: "Sport", ar: "رياضي", en: "Sport" },
  formal: { fr: "Habillé / Classique", ar: "كلاسيكي / رسمي", en: "Formal" },
  kids: { fr: "Enfants", ar: "أطفال", en: "Kids" },
  slippers: { fr: "Pantoufles / Claquettes", ar: "نعال / شباشب", en: "Slippers" },
  accessories: { fr: "Accessoires", ar: "إكسسوارات", en: "Accessories" },
  other: { fr: "Autre", ar: "أخرى", en: "Other" },
};

const GENDER_MAP: Record<string, Record<SupportedLang, string>> = {
  M: { fr: "Homme", ar: "رجالي", en: "Men" },
  F: { fr: "Femme", ar: "نسائي", en: "Women" },
  U: { fr: "Unisexe", ar: "للجنسين", en: "Unisex" },
  K: { fr: "Enfant", ar: "أطفال", en: "Kids" },
};

const SEASON_MAP: Record<string, Record<SupportedLang, string>> = {
  spring_summer: { fr: "Printemps / Été", ar: "ربيع / صيف", en: "Spring / Summer" },
  autumn_winter: { fr: "Automne / Hiver", ar: "خريف / شتاء", en: "Autumn / Winter" },
  all_season: { fr: "Toutes saisons", ar: "كل الفصول", en: "All Seasons" },
};

const PAYMENT_METHOD_MAP: Record<string, Record<SupportedLang, string>> = {
  cash: { fr: "Espèces", ar: "نقداً", en: "Cash" },
  tpe: { fr: "TPE / CIB / Edahabia", ar: "بطاقة CIB / الذهبية", en: "Card (TPE/CIB)" },
  baridimob: { fr: "BaridiMob", ar: "بريدي موب", en: "BaridiMob" },
  ccp: { fr: "CCP", ar: "حساب بريدي CCP", en: "CCP" },
  virement: { fr: "Virement bancaire", ar: "تحويل بنكي", en: "Bank Transfer" },
  cheque: { fr: "Chèque", ar: "شيك", en: "Cheque" },
  account: { fr: "À crédit (Compte client)", ar: "على الحساب (دين)", en: "Client Credit" },
};

const SALE_STATUS_MAP: Record<string, Record<SupportedLang, string>> = {
  complete: { fr: "Complète", ar: "مكتملة", en: "Completed" },
  partial: { fr: "Versement / Crédit", ar: "تسبيق / دين", en: "Partial / Credit" },
  layaway: { fr: "Réservation (Mise de côté)", ar: "حجز (وضع جانباً)", en: "Layaway / Reserved" },
  voided: { fr: "Annulée", ar: "ملغاة", en: "Voided" },
};

const LOYALTY_TIER_MAP: Record<string, Record<SupportedLang, string>> = {
  bronze: { fr: "Bronze", ar: "برونزي", en: "Bronze" },
  silver: { fr: "Argent", ar: "فضي", en: "Silver" },
  gold: { fr: "Or", ar: "ذهبي", en: "Gold" },
};

const CHEQUE_STATUS_MAP: Record<string, Record<SupportedLang, string>> = {
  pending: { fr: "En attente", ar: "قيد الانتظار", en: "Pending" },
  deposited: { fr: "Encaissé / Déposé", ar: "تم التحصيل / مودع", en: "Deposited" },
  bounced: { fr: "Impayé / Rejeté", ar: "غير مدفوع / مرفوض", en: "Bounced" },
};

export function formatCategoryLabel(category?: string | null, lang?: SupportedLang): string {
  if (!category) return "—";
  const l = lang || getActiveUiLang();
  return CATEGORY_MAP[category]?.[l] || category;
}

export function formatGenderLabel(gender?: string | null, lang?: SupportedLang): string {
  if (!gender) return "—";
  const l = lang || getActiveUiLang();
  return GENDER_MAP[gender]?.[l] || gender;
}

export function formatSeasonLabel(season?: string | null, lang?: SupportedLang): string {
  if (!season) return "—";
  const l = lang || getActiveUiLang();
  return SEASON_MAP[season]?.[l] || season;
}

export function formatPaymentMethodLabel(
  method?: string | null,
  lang?: SupportedLang | "bilingual"
): string {
  if (!method) return "—";
  const l = lang || getActiveUiLang();
  if (l === "bilingual") {
    const fr = PAYMENT_METHOD_MAP[method]?.fr || method;
    const ar = PAYMENT_METHOD_MAP[method]?.ar;
    return ar ? `${fr} / ${ar}` : fr;
  }
  return PAYMENT_METHOD_MAP[method]?.[l] || method;
}

export function formatSaleStatusLabel(status?: string | null, lang?: SupportedLang): string {
  if (!status) return "—";
  const l = lang || getActiveUiLang();
  return SALE_STATUS_MAP[status]?.[l] || status;
}

export function formatLoyaltyTierLabel(
  tier?: string | null,
  lang?: SupportedLang | "bilingual"
): string {
  if (!tier) return "—";
  const l = lang || getActiveUiLang();
  if (l === "bilingual") {
    const fr = LOYALTY_TIER_MAP[tier]?.fr || tier;
    const ar = LOYALTY_TIER_MAP[tier]?.ar;
    return ar ? `${fr} / ${ar}` : fr;
  }
  return LOYALTY_TIER_MAP[tier]?.[l] || tier;
}

export function formatChequeStatusLabel(status?: string | null, lang?: SupportedLang): string {
  if (!status) return "—";
  const l = lang || getActiveUiLang();
  return CHEQUE_STATUS_MAP[status]?.[l] || status;
}
