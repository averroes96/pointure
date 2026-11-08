import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const SHORTCUTS_MODAL_PATH = path.resolve(
  __dirname,
  "../../components/ui/ShortcutsModal.tsx"
);

const MANUAL_SHORTCUT_FILES = [
  "manual/src/fr/cashier/11-raccourcis.md",
  "manual/src/ar/cashier/11-raccourcis.md",
  "manual/src/en/cashier/11-raccourcis.md",
];

/**
 * Extracts all `{ key: "..." }` definitions from ShortcutsModal.tsx.
 */
function extractModalShortcutKeys(): string[] {
  const source = fs.readFileSync(SHORTCUTS_MODAL_PATH, "utf-8");
  const matches = Array.from(source.matchAll(/\{\s*key:\s*"([^"]+)"/g));
  return Array.from(new Set(matches.map((m) => m[1])));
}

describe("ShortcutsModal <-> User Manual sync (Task 6.13)", () => {
  it("extracts shortcut keys from ShortcutsModal.tsx", () => {
    const keys = extractModalShortcutKeys();
    expect(keys.length).toBeGreaterThanOrEqual(15);
    expect(keys).toContain("F1");
    expect(keys).toContain("Alt + H");
    expect(keys).toContain("F12");
  });

  it.each(MANUAL_SHORTCUT_FILES)(
    "documents every ShortcutsModal key in %s",
    (relativeManualPath) => {
      const fullPath = path.join(REPO_ROOT, relativeManualPath);
      const markdown = fs.readFileSync(fullPath, "utf-8");
      const keys = extractModalShortcutKeys();

      for (const rawKey of keys) {
        // Composite key "F10 · ." is documented as <kbd>F10</kbd> and <kbd>.</kbd>
        if (rawKey === "F10 · .") {
          expect(markdown).toContain("<kbd>F10</kbd>");
          expect(markdown).toContain("<kbd>.</kbd>");
          continue;
        }
        // "Échap" in FR/AR corresponds to "Esc" in EN
        if (rawKey === "Échap") {
          const hasEscape =
            markdown.includes("<kbd>Échap</kbd>") ||
            markdown.includes("<kbd>Esc</kbd>");
          expect(hasEscape).toBe(true);
          continue;
        }
        expect(markdown).toContain(`<kbd>${rawKey}</kbd>`);
      }
    }
  );
});

