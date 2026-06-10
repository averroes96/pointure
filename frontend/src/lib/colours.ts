/**
 * Canonical shoe colour list.
 * value  → stored in DB (English, snake_case)
 * label  → displayed in UI (French)
 * hex    → swatch preview colour
 */
export interface Colour {
  value: string;
  label: string;
  hex: string | null;
}

export const COLOURS: Colour[] = [
  // ── Achromatic ───────────────────────────────────────────────────────────
  { value: "black",       label: "Noir",           hex: "#111827" },
  { value: "white",       label: "Blanc",          hex: "#f9fafb" },
  { value: "light_grey",  label: "Gris clair",     hex: "#d1d5db" },
  { value: "grey",        label: "Gris",           hex: "#9ca3af" },
  { value: "dark_grey",   label: "Gris foncé",     hex: "#4b5563" },
  { value: "charcoal",    label: "Anthracite",     hex: "#374151" },

  // ── Browns / Naturals ─────────────────────────────────────────────────────
  { value: "ivory",       label: "Ivoire",         hex: "#fdf9ee" },
  { value: "cream",       label: "Crème",          hex: "#f5f0dc" },
  { value: "natural",     label: "Naturel",        hex: "#e8dcc8" },
  { value: "sand",        label: "Sable",          hex: "#d4b896" },
  { value: "beige",       label: "Beige",          hex: "#c9a97a" },
  { value: "camel",       label: "Camel",          hex: "#c19a6b" },
  { value: "tan",         label: "Fauve",          hex: "#d2691e" },
  { value: "cognac",      label: "Cognac",         hex: "#9f4a11" },
  { value: "light_brown", label: "Marron clair",   hex: "#a0522d" },
  { value: "brown",       label: "Marron",         hex: "#7c3a1e" },
  { value: "dark_brown",  label: "Marron foncé",   hex: "#451a03" },
  { value: "chocolate",   label: "Chocolat",       hex: "#3d1c02" },
  { value: "terracotta",  label: "Terre cuite",    hex: "#c1613a" },

  // ── Blues ─────────────────────────────────────────────────────────────────
  { value: "sky_blue",    label: "Bleu ciel",      hex: "#7dd3fc" },
  { value: "turquoise",   label: "Turquoise",      hex: "#2dd4bf" },
  { value: "teal",        label: "Bleu canard",    hex: "#0d9488" },
  { value: "blue",        label: "Bleu",           hex: "#3b82f6" },
  { value: "cobalt",      label: "Cobalt",         hex: "#1a56db" },
  { value: "royal_blue",  label: "Bleu roi",       hex: "#1e40af" },
  { value: "navy",        label: "Marine",         hex: "#1e3a5f" },
  { value: "dark_navy",   label: "Marine foncé",   hex: "#0f1f3d" },
  { value: "jeans",       label: "Jean",           hex: "#3b6ea5" },

  // ── Greens ────────────────────────────────────────────────────────────────
  { value: "mint",        label: "Menthe",         hex: "#6ee7b7" },
  { value: "sage",        label: "Sauge",          hex: "#84a98c" },
  { value: "green",       label: "Vert",           hex: "#16a34a" },
  { value: "forest_green",label: "Vert forêt",     hex: "#166534" },
  { value: "dark_green",  label: "Vert foncé",     hex: "#14532d" },
  { value: "olive",       label: "Olive",          hex: "#6b7a40" },
  { value: "khaki",       label: "Kaki",           hex: "#a8a86a" },
  { value: "army",        label: "Militaire",      hex: "#4a5240" },

  // ── Reds / Pinks ─────────────────────────────────────────────────────────
  { value: "blush",       label: "Rose poudré",    hex: "#ffc8c8" },
  { value: "salmon",      label: "Saumon",         hex: "#fa8072" },
  { value: "coral",       label: "Corail",         hex: "#f97060" },
  { value: "pink",        label: "Rose",           hex: "#f472b6" },
  { value: "hot_pink",    label: "Rose vif",       hex: "#ec4899" },
  { value: "fuchsia",     label: "Fuchsia",        hex: "#d946ef" },
  { value: "red",         label: "Rouge",          hex: "#dc2626" },
  { value: "dark_red",    label: "Rouge foncé",    hex: "#991b1b" },
  { value: "wine",        label: "Bordeaux vin",   hex: "#6b1f2a" },
  { value: "burgundy",    label: "Bordeaux",       hex: "#800020" },

  // ── Purples ───────────────────────────────────────────────────────────────
  { value: "lavender",    label: "Lavande",        hex: "#c4b5fd" },
  { value: "lilac",       label: "Lilas",          hex: "#a78bfa" },
  { value: "mauve",       label: "Mauve",          hex: "#8b5cf6" },
  { value: "purple",      label: "Violet",         hex: "#7c3aed" },
  { value: "dark_purple", label: "Violet foncé",   hex: "#4c1d95" },
  { value: "plum",        label: "Prune",          hex: "#581c87" },

  // ── Yellows / Oranges ─────────────────────────────────────────────────────
  { value: "cream_yellow",label: "Jaune crème",    hex: "#fef9c3" },
  { value: "yellow",      label: "Jaune",          hex: "#facc15" },
  { value: "mustard",     label: "Moutarde",       hex: "#ca8a04" },
  { value: "orange",      label: "Orange",         hex: "#f97316" },
  { value: "burnt_orange",label: "Orange brûlé",   hex: "#c2410c" },

  // ── Metallics ─────────────────────────────────────────────────────────────
  { value: "gold",        label: "Or",             hex: "#d4af37" },
  { value: "rose_gold",   label: "Or rose",        hex: "#b76e79" },
  { value: "copper",      label: "Cuivre",         hex: "#b87333" },
  { value: "bronze",      label: "Bronze",         hex: "#cd7f32" },
  { value: "silver",      label: "Argent",         hex: "#c0c0c0" },
  { value: "platinum",    label: "Platine",        hex: "#e5e4e2" },

  // ── Special ───────────────────────────────────────────────────────────────
  { value: "multicolor",  label: "Multicolore",    hex: null },
  { value: "bicolor",     label: "Bicolore",       hex: null },
  { value: "printed",     label: "Imprimé",        hex: null },
  { value: "transparent", label: "Transparent",    hex: null },
];

/** Map English value → Colour object for fast lookup. */
const COLOUR_MAP = new Map(COLOURS.map((c) => [c.value, c]));

/** Return the French label for a stored English value. Falls back to the raw value. */
export function getColourLabel(value: string): string {
  return COLOUR_MAP.get(value)?.label ?? value;
}

/** Return the hex code for a stored English value, or null. */
export function getColourHex(value: string): string | null {
  return COLOUR_MAP.get(value)?.hex ?? null;
}
