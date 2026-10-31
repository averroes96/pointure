import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import ar from "../locales/ar.json";
import fr from "../locales/fr.json";
import en from "../locales/en.json";

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { ar: { translation: ar }, fr: { translation: fr }, en: { translation: en } },
    fallbackLng: "fr",
    supportedLngs: ["ar", "fr", "en"],
    interpolation: { escapeValue: false },
    detection: {
      order: ["localStorage", "navigator"],
      caches: ["localStorage"],
    },
  });

/** Apply RTL direction and lang attribute to <html> */
export function applyDirection(lang?: string) {
  const effective =
    lang ||
    i18n.language ||
    (typeof localStorage !== "undefined" ? localStorage.getItem("i18nextLng") : null) ||
    "fr";
  const isRTL = effective === "ar" || effective.startsWith("ar");
  document.documentElement.dir = isRTL ? "rtl" : "ltr";
  document.documentElement.lang = isRTL ? "ar" : effective;
}

// Immediately apply direction for the detected language on module load
applyDirection(i18n.language || "fr");

// Ensure documentElement is synchronized whenever language changes
i18n.on("languageChanged", (lng) => {
  applyDirection(lng);
});

export default i18n;
