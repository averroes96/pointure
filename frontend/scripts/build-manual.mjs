#!/usr/bin/env node
/**
 * ShoeDZ Manual Builder
 *
 * Compiles user manual Markdown sources (manual/src/{fr,ar,en}/{cashier,owner}/*.md)
 * into standalone, self-contained HTML documents in frontend/public/manual/{lang}/{guide}.html.
 *
 * Validations:
 * 1. Cross-language heading anchor consistency:
 *    Fails build if an explicit heading anchor {#id} in one language is missing in another.
 * 2. Broken internal links:
 *    Fails build if an internal link (#anchor) refers to a non-existent heading or ID.
 * 3. Missing image check:
 *    Warns if an image reference is not found in manual/assets/.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { marked } from "marked";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FRONTEND_DIR = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(FRONTEND_DIR, "..");
const MANUAL_SRC_DIR = path.resolve(REPO_ROOT, "manual/src");
const MANUAL_ASSETS_SRC_DIR = path.resolve(REPO_ROOT, "manual/assets");
const OUTPUT_DIR = path.resolve(FRONTEND_DIR, "public/manual");
const OUTPUT_ASSETS_DIR = path.resolve(OUTPUT_DIR, "assets");

const LANGUAGES = ["fr", "ar", "en"];
const GUIDES = ["cashier", "owner"];

const LANG_CONFIG = {
  fr: {
    name: "Français",
    dir: "ltr",
    tocTitle: "Table des matières",
    otherGuideLabel: (guide) => (guide === "cashier" ? "Guide Propriétaire" : "Guide Caisse"),
    printLabel: "Imprimer",
    backToTop: "Haut de page",
  },
  ar: {
    name: "العربية",
    dir: "rtl",
    tocTitle: "جدول المحتويات",
    otherGuideLabel: (guide) => (guide === "cashier" ? "دليل المالك والمدير" : "دليل نقطة البيع"),
    printLabel: "طباعة",
    backToTop: "أعلى الصفحة",
  },
  en: {
    name: "English",
    dir: "ltr",
    tocTitle: "Table of Contents",
    otherGuideLabel: (guide) => (guide === "cashier" ? "Owner Guide" : "Cashier Guide"),
    printLabel: "Print",
    backToTop: "Back to top",
  },
};

const GUIDE_TITLES = {
  cashier: {
    fr: "Guide Utilisateur — Caisse & Point de Vente",
    ar: "دليل المستخدم — نقطة البيع والصندوق",
    en: "Cashier User Guide — Point of Sale",
  },
  owner: {
    fr: "Guide Propriétaire & Gestionnaire",
    ar: "دليل المالك والمدير",
    en: "Store Owner & Manager Guide",
  },
};

/**
 * Pre-processes markdown blockquote alerts:
 * > [!TIP] ... -> <div class="tip">...</div>
 * > [!WARNING] ... -> <div class="warning">...</div>
 * > [!NOTE] ... -> <div class="note">...</div>
 */
function preprocessAlerts(markdown) {
  const lines = markdown.split(/\r?\n/);
  const result = [];
  let inAlert = null;
  let alertContent = [];

  function flushAlert() {
    if (inAlert) {
      const innerHtml = marked.parse(alertContent.join("\n"));
      result.push(`<div class="${inAlert}">\n${innerHtml}\n</div>`);
      inAlert = null;
      alertContent = [];
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const alertMatch = line.match(/^>\s*\[!(TIP|WARNING|CAUTION|NOTE|IMPORTANT)\]\s*(.*)$/i);

    if (alertMatch) {
      flushAlert();
      const type = alertMatch[1].toUpperCase();
      inAlert = (type === "TIP") ? "tip" : (type === "WARNING" || type === "CAUTION") ? "warning" : "note";
      if (alertMatch[2].trim()) {
        alertContent.push(alertMatch[2].trim());
      }
    } else if (inAlert && line.startsWith(">")) {
      alertContent.push(line.replace(/^>\s?/, ""));
    } else {
      flushAlert();
      result.push(line);
    }
  }

  flushAlert();

  return result.join("\n");
}

/**
 * Slugify text when no explicit anchor {#id} is provided.
 */
function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\u0600-\u06FF]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Extracts explicit anchor {#id} and title from heading string.
 */
function parseHeadingText(text) {
  const match = text.match(/^(.*?)\s*\{#([a-zA-Z0-9_-]+)\}\s*$/);
  if (match) {
    return {
      title: match[1].trim(),
      id: match[2].trim(),
      explicit: true,
    };
  }
  return {
    title: text.trim(),
    id: slugify(text),
    explicit: false,
  };
}

/**
 * Builds standalone HTML with embedded styling, dark mode, print, and RTL support.
 */
function generateHtmlDocument({
  lang,
  guide,
  contentHtml,
  tocHtml,
  pageTitle,
}) {
  const conf = LANG_CONFIG[lang];
  const isRtl = conf.dir === "rtl";
  const otherGuide = guide === "cashier" ? "owner" : "cashier";
  const otherGuideUrl = `${otherGuide}.html`;
  const otherGuideText = conf.otherGuideLabel(guide);

  return `<!DOCTYPE html>
<html lang="${lang}" dir="${conf.dir}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ShoeDZ — ${pageTitle}</title>
  <style>
    @page { size: A4; margin: 18mm 16mm; }

    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg: #ffffff;
      --text: #1e293b;
      --text-muted: #64748b;
      --surface: #f8fafc;
      --surface-border: #e2e8f0;
      --primary: #4f46e5;
      --primary-hover: #4338ca;
      --primary-light: #eef2ff;
      --accent: #818cf8;
      --card-bg: #ffffff;
      --header-bg: #ffffff;
      --header-border: #e2e8f0;
    }

    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #0f172a;
        --text: #f1f5f9;
        --text-muted: #94a3b8;
        --surface: #1e293b;
        --surface-border: #334155;
        --primary: #6366f1;
        --primary-hover: #818cf8;
        --primary-light: rgba(99, 102, 241, 0.15);
        --accent: #a5b4fc;
        --card-bg: #1e293b;
        --header-bg: #0f172a;
        --header-border: #334155;
      }
    }

    body {
      font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, Arial, sans-serif;
      font-size: 14.5px;
      line-height: 1.7;
      color: var(--text);
      background: var(--bg);
      -webkit-font-smoothing: antialiased;
    }

    /* ── Sticky Topbar ── */
    header.manual-header {
      position: sticky;
      top: 0;
      z-index: 100;
      background: var(--header-bg);
      border-bottom: 1px solid var(--header-border);
      padding: 10px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      backdrop-filter: blur(8px);
    }

    .brand-group {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .brand-logo {
      width: 32px;
      height: 32px;
      background: var(--primary);
      color: #fff;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 800;
      font-size: 16px;
    }

    .brand-title {
      font-size: 15px;
      font-weight: 700;
      color: var(--text);
    }

    .header-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .btn-nav {
      font-size: 12px;
      padding: 6px 12px;
      border-radius: 8px;
      border: 1px solid var(--surface-border);
      background: var(--surface);
      color: var(--text);
      text-decoration: none;
      cursor: pointer;
      font-weight: 600;
      transition: all 0.15s ease;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }

    .btn-nav:hover {
      background: var(--primary-light);
      border-color: var(--accent);
      color: var(--primary);
    }

    .lang-switcher {
      display: inline-flex;
      background: var(--surface);
      border: 1px solid var(--surface-border);
      border-radius: 8px;
      padding: 2px;
    }

    .lang-switcher a {
      padding: 4px 8px;
      font-size: 11px;
      font-weight: 700;
      color: var(--text-muted);
      text-decoration: none;
      border-radius: 6px;
      text-transform: uppercase;
    }

    .lang-switcher a.active {
      background: var(--primary);
      color: #ffffff;
    }

    /* ── Main Layout ── */
    .manual-layout {
      max-width: 1080px;
      margin: 0 auto;
      padding: 32px 24px 80px 24px;
    }

    /* ── TOC ── */
    nav.toc {
      background: var(--surface);
      border: 1px solid var(--surface-border);
      border-radius: 12px;
      padding: 24px;
      margin-bottom: 36px;
    }

    nav.toc h2 {
      font-size: 18px;
      font-weight: 700;
      color: var(--text);
      margin-bottom: 16px;
      border-bottom: 2px solid var(--surface-border);
      padding-bottom: 8px;
    }

    nav.toc ol {
      list-style: none;
      padding: 0;
      margin: 0;
    }

    nav.toc > ol > li {
      margin-bottom: 8px;
    }

    nav.toc a {
      color: var(--primary);
      text-decoration: none;
      font-weight: 600;
      font-size: 14px;
    }

    nav.toc a:hover {
      text-decoration: underline;
    }

    nav.toc ol.toc-sub {
      padding-${isRtl ? 'right' : 'left'}: 20px;
      margin-top: 4px;
    }

    nav.toc ol.toc-sub li {
      margin-bottom: 4px;
    }

    nav.toc ol.toc-sub a {
      font-weight: normal;
      font-size: 13px;
      color: var(--text-muted);
    }

    /* ── Typography & Headings ── */
    h1 {
      font-size: 28px;
      font-weight: 800;
      color: var(--text);
      margin-top: 0;
      margin-bottom: 24px;
      line-height: 1.3;
    }

    h2.manual-heading {
      font-size: 22px;
      font-weight: 700;
      color: var(--text);
      margin-top: 40px;
      margin-bottom: 16px;
      padding-bottom: 6px;
      border-bottom: 2px solid var(--surface-border);
      position: relative;
    }

    h3.manual-heading {
      font-size: 17px;
      font-weight: 600;
      color: var(--text);
      margin-top: 28px;
      margin-bottom: 12px;
      position: relative;
    }

    h4.manual-heading {
      font-size: 15px;
      font-weight: 600;
      color: var(--primary);
      margin-top: 20px;
      margin-bottom: 8px;
    }

    .anchor-link {
      opacity: 0;
      color: var(--accent);
      text-decoration: none;
      font-weight: normal;
      margin-${isRtl ? 'left' : 'right'}: 8px;
      transition: opacity 0.15s ease;
    }

    h2.manual-heading:hover .anchor-link,
    h3.manual-heading:hover .anchor-link {
      opacity: 1;
    }

    p {
      margin-bottom: 14px;
    }

    strong {
      color: var(--text);
      font-weight: 600;
    }

    ul, ol {
      margin-bottom: 16px;
      padding-${isRtl ? 'right' : 'left'}: 24px;
    }

    li {
      margin-bottom: 6px;
    }

    /* ── Callouts / Alerts ── */
    .tip, .warning, .note {
      border-radius: 8px;
      padding: 14px 18px;
      margin: 18px 0;
      font-size: 13.5px;
      border-${isRtl ? 'right' : 'left'}: 4px solid;
    }

    .tip {
      background: #eff6ff;
      border-color: #3b82f6;
      color: #1e40af;
    }

    .warning {
      background: #fff7ed;
      border-color: #f97316;
      color: #9a3412;
    }

    .note {
      background: #f0fdf4;
      border-color: #22c55e;
      color: #166534;
    }

    @media (prefers-color-scheme: dark) {
      .tip {
        background: rgba(59, 130, 246, 0.12);
        color: #93c5fd;
      }
      .warning {
        background: rgba(249, 115, 22, 0.12);
        color: #fdba74;
      }
      .note {
        background: rgba(34, 197, 94, 0.12);
        color: #86efac;
      }
    }

    /* ── Tables ── */
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 20px 0;
      font-size: 13.5px;
      background: var(--card-bg);
      border-radius: 8px;
      overflow: hidden;
      border: 1px solid var(--surface-border);
    }

    thead th {
      background: var(--surface);
      color: var(--text);
      padding: 10px 14px;
      text-align: ${isRtl ? 'right' : 'left'};
      font-weight: 700;
      border-bottom: 1px solid var(--surface-border);
    }

    tbody td {
      padding: 10px 14px;
      border-bottom: 1px solid var(--surface-border);
    }

    tbody tr:last-child td {
      border-bottom: none;
    }

    /* ── Keyboard Keys ── */
    kbd {
      display: inline-block;
      padding: 2px 6px;
      font-size: 11.5px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-weight: 700;
      color: var(--text);
      background: var(--surface);
      border: 1px solid var(--surface-border);
      border-radius: 4px;
      box-shadow: 0 1px 0 rgba(0, 0, 0, 0.1);
    }

    /* ── Images & Figures ── */
    img {
      max-width: 100%;
      height: auto;
      border-radius: 8px;
      border: 1px solid var(--surface-border);
      margin: 14px 0;
      display: block;
    }

    /* ── Floating Back to Top ── */
    .back-to-top {
      position: fixed;
      bottom: 24px;
      ${isRtl ? 'left' : 'right'}: 24px;
      background: var(--surface);
      border: 1px solid var(--surface-border);
      color: var(--text-muted);
      padding: 8px 14px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
      text-decoration: none;
      box-shadow: 0 2px 8px rgba(0,0,0,0.08);
      transition: all 0.15s ease;
    }

    .back-to-top:hover {
      background: var(--primary);
      color: #fff;
    }

    /* ── Print Media ── */
    @media print {
      header.manual-header,
      .back-to-top,
      .anchor-link {
        display: none !important;
      }
      .manual-layout {
        max-width: 100%;
        padding: 0;
      }
      h2.manual-heading {
        page-break-before: always;
      }
      h2.manual-heading:first-of-type {
        page-break-before: avoid;
      }
      table, .tip, .warning, .note {
        page-break-inside: avoid;
      }
    }
  </style>
</head>
<body>
  <header class="manual-header">
    <div class="brand-group">
      <div class="brand-logo">S</div>
      <div>
        <div class="brand-title">ShoeDZ — Pointure</div>
      </div>
    </div>

    <div class="header-actions">
      <a href="${otherGuideUrl}" class="btn-nav" onclick="navigateToGuide(event, '${otherGuideUrl}')">
        <span>${otherGuideText}</span>
      </a>

      <div class="lang-switcher">
        ${LANGUAGES.map((l) => {
          const activeClass = l === lang ? 'class="active"' : '';
          return `<a href="../${l}/${guide}.html" ${activeClass} onclick="switchLanguage(event, '${l}')">${l}</a>`;
        }).join("\n        ")}
      </div>

      <button onclick="window.print()" class="btn-nav">
        <span>${conf.printLabel}</span>
      </button>
    </div>
  </header>

  <main class="manual-layout" id="top">
    ${tocHtml}
    <article class="manual-content">
      ${contentHtml}
    </article>
  </main>

  <a href="#top" class="back-to-top">↑ ${conf.backToTop}</a>

  <script>
    function switchLanguage(e, targetLang) {
      e.preventDefault();
      var hash = window.location.hash || '';
      window.location.href = '../' + targetLang + '/${guide}.html' + hash;
    }

    function navigateToGuide(e, targetUrl) {
      e.preventDefault();
      var hash = window.location.hash || '';
      window.location.href = targetUrl + hash;
    }
  </script>
</body>
</html>`;
}

/**
 * Main build process
 */
async function buildManual() {
  console.log("📘 Building ShoeDZ User Manual...");

  // 1. Ensure target directories exist
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.mkdirSync(OUTPUT_ASSETS_DIR, { recursive: true });

  // 2. Copy assets if present
  if (fs.existsSync(MANUAL_ASSETS_SRC_DIR)) {
    for (const lang of LANGUAGES) {
      const srcLangAssets = path.join(MANUAL_ASSETS_SRC_DIR, lang);
      const destLangAssets = path.join(OUTPUT_ASSETS_DIR, lang);
      if (fs.existsSync(srcLangAssets)) {
        fs.mkdirSync(destLangAssets, { recursive: true });
        fs.cpSync(srcLangAssets, destLangAssets, { recursive: true });
      }
    }
  }

  // Track anchors per guide per language to perform consistency validation
  const anchorsByGuideAndLang = {
    cashier: { fr: new Set(), ar: new Set(), en: new Set() },
    owner: { fr: new Set(), ar: new Set(), en: new Set() },
  };

  const internalLinksByFile = [];
  const missingImages = [];

  // 3. Process each guide and language
  for (const guide of GUIDES) {
    for (const lang of LANGUAGES) {
      const guideSrcDir = path.join(MANUAL_SRC_DIR, lang, guide);
      const outLangDir = path.join(OUTPUT_DIR, lang);
      fs.mkdirSync(outLangDir, { recursive: true });

      if (!fs.existsSync(guideSrcDir)) {
        fs.mkdirSync(guideSrcDir, { recursive: true });
      }

      // Collect chapter files sorted numerically
      const chapterFiles = fs
        .readdirSync(guideSrcDir)
        .filter((f) => f.endsWith(".md"))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

      if (chapterFiles.length === 0) {
        console.warn(`[Warning] No markdown chapters found in ${guideSrcDir}`);
        continue;
      }

      const headings = [];
      const documentIds = new Set();
      documentIds.add("top");

      // Configure marked with a custom heading renderer
      const renderer = new marked.Renderer();

      renderer.heading = function (token) {
        const rawText = token.text;
        const parsed = parseHeadingText(rawText);
        const depth = token.depth;
        const id = parsed.id;

        documentIds.add(id);

        if (parsed.explicit) {
          anchorsByGuideAndLang[guide][lang].add(id);
        }

        // Add to Table of Contents list
        headings.push({
          depth,
          id,
          title: parsed.title,
        });

        const anchorTag = depth > 1
          ? `<a href="#${id}" class="anchor-link" aria-label="Lien direct">#</a>`
          : "";

        return `<h${depth} id="${id}" class="manual-heading">${anchorTag}${parsed.title}</h${depth}>\n`;
      };

      marked.use({ renderer });

      // Combine and preprocess chapters
      const combinedMarkdown = chapterFiles
        .map((f) => fs.readFileSync(path.join(guideSrcDir, f), "utf-8"))
        .join("\n\n");

      const preprocessed = preprocessAlerts(combinedMarkdown);
      const contentHtml = marked.parse(preprocessed);

      // Check images in content
      const imgRegex = /<img[^>]+src=["']([^"']+)["']/gi;
      let imgMatch;
      while ((imgMatch = imgRegex.exec(contentHtml)) !== null) {
        const imgSrc = imgMatch[1];
        if (!imgSrc.startsWith("http://") && !imgSrc.startsWith("https://") && !imgSrc.startsWith("data:")) {
          const resolvedPath = path.resolve(outLangDir, imgSrc);
          if (!fs.existsSync(resolvedPath)) {
            missingImages.push({
              file: `${lang}/${guide}.html`,
              src: imgSrc,
            });
          }
        }
      }

      // Collect internal links to validate
      const linkRegex = /<a[^>]+href=["']#([^"']+)["']/gi;
      let linkMatch;
      const links = [];
      while ((linkMatch = linkRegex.exec(contentHtml)) !== null) {
        links.push(linkMatch[1]);
      }
      internalLinksByFile.push({
        file: `${lang}/${guide}.html`,
        validIds: documentIds,
        links,
      });

      // Build Table of Contents HTML
      let tocHtml = "";
      const tocHeadings = headings.filter((h) => h.depth === 2 || h.depth === 3);

      if (tocHeadings.length > 0) {
        let tocListHtml = "<ol>";
        let currentH2Open = false;

        for (const h of tocHeadings) {
          if (h.depth === 2) {
            if (currentH2Open) {
              tocListHtml += "</ol></li>";
            }
            tocListHtml += `<li><a href="#${h.id}">${h.title}</a><ol class="toc-sub">`;
            currentH2Open = true;
          } else if (h.depth === 3) {
            if (!currentH2Open) {
              tocListHtml += `<li><ol class="toc-sub">`;
              currentH2Open = true;
            }
            tocListHtml += `<li><a href="#${h.id}">${h.title}</a></li>`;
          }
        }

        if (currentH2Open) {
          tocListHtml += "</ol></li>";
        }
        tocListHtml += "</ol>";

        tocHtml = `<nav class="toc">
  <h2>${LANG_CONFIG[lang].tocTitle}</h2>
  ${tocListHtml}
</nav>`;
      }

      const pageTitle = GUIDE_TITLES[guide][lang] || "Manuel";
      const fullHtml = generateHtmlDocument({
        lang,
        guide,
        contentHtml,
        tocHtml,
        pageTitle,
      });

      const outPath = path.join(outLangDir, `${guide}.html`);
      fs.writeFileSync(outPath, fullHtml, "utf-8");
      console.log(`  ✓ Built ${path.relative(REPO_ROOT, outPath)}`);
    }
  }

  // 4. Validate Cross-Language Anchors
  console.log("\n🔍 Validating heading anchors across languages...");
  let hasAnchorMismatch = false;

  for (const guide of GUIDES) {
    const frAnchors = anchorsByGuideAndLang[guide].fr;
    const arAnchors = anchorsByGuideAndLang[guide].ar;
    const enAnchors = anchorsByGuideAndLang[guide].en;

    const missingInAr = [...frAnchors].filter((a) => !arAnchors.has(a));
    const missingInEn = [...frAnchors].filter((a) => !enAnchors.has(a));
    const extraInAr = [...arAnchors].filter((a) => !frAnchors.has(a));
    const extraInEn = [...enAnchors].filter((a) => !frAnchors.has(a));

    if (missingInAr.length || missingInEn.length || extraInAr.length || extraInEn.length) {
      hasAnchorMismatch = true;
      console.error(`\n❌ Error: Anchor mismatch detected in "${guide}" guide:`);
      if (missingInAr.length) {
        console.error(`  - Defined in [fr] but missing in [ar]: ${missingInAr.join(", ")}`);
      }
      if (missingInEn.length) {
        console.error(`  - Defined in [fr] but missing in [en]: ${missingInEn.join(", ")}`);
      }
      if (extraInAr.length) {
        console.error(`  - Defined in [ar] but missing in [fr]: ${extraInAr.join(", ")}`);
      }
      if (extraInEn.length) {
        console.error(`  - Defined in [en] but missing in [fr]: ${extraInEn.join(", ")}`);
      }
    }
  }

  if (hasAnchorMismatch) {
    console.error("\n❌ Manual build failed: heading anchors must match across all three languages (fr, ar, en).");
    process.exit(1);
  }

  // 5. Validate Internal Links
  console.log("🔗 Validating internal anchor links...");
  let hasBrokenLinks = false;

  for (const { file, validIds, links } of internalLinksByFile) {
    for (const targetId of links) {
      if (!validIds.has(targetId)) {
        hasBrokenLinks = true;
        console.error(`❌ Broken link in ${file}: target anchor "#${targetId}" does not exist in the document.`);
      }
    }
  }

  if (hasBrokenLinks) {
    console.error("\n❌ Manual build failed: broken internal links detected.");
    process.exit(1);
  }

  // 6. Check Missing Images (Warnings only)
  if (missingImages.length > 0) {
    console.warn(`\n⚠️ Missing image warnings (${missingImages.length}):`);
    for (const { file, src } of missingImages) {
      console.warn(`  - [${file}] Image not found: ${src}`);
    }
  }

  console.log("\n✅ Manual build completed successfully!");
}

buildManual().catch((err) => {
  console.error("\n❌ Unexpected error during manual build:", err);
  process.exit(1);
});

