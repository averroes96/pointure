/**
 * Algerian wilaya reference data — mirrors backend WILAYA_CHOICES in
 * apps/core/models.py.
 *
 * Storage contract: wilayas are stored as 2-char codes ("16") in the DB.
 * Display: "16 - Alger" in inputs/datalists, "Alger" in table cells.
 */

export interface WilayaEntry {
  code: string; // "01" – "58"
  name: string; // "Adrar", "Alger", …
}

export const WILAYA_ENTRIES: WilayaEntry[] = [
  { code: "01", name: "Adrar" },
  { code: "02", name: "Chlef" },
  { code: "03", name: "Laghouat" },
  { code: "04", name: "Oum El Bouaghi" },
  { code: "05", name: "Batna" },
  { code: "06", name: "Béjaïa" },
  { code: "07", name: "Biskra" },
  { code: "08", name: "Béchar" },
  { code: "09", name: "Blida" },
  { code: "10", name: "Bouira" },
  { code: "11", name: "Tamanrasset" },
  { code: "12", name: "Tébessa" },
  { code: "13", name: "Tlemcen" },
  { code: "14", name: "Tiaret" },
  { code: "15", name: "Tizi Ouzou" },
  { code: "16", name: "Alger" },
  { code: "17", name: "Djelfa" },
  { code: "18", name: "Jijel" },
  { code: "19", name: "Sétif" },
  { code: "20", name: "Saïda" },
  { code: "21", name: "Skikda" },
  { code: "22", name: "Sidi Bel Abbès" },
  { code: "23", name: "Annaba" },
  { code: "24", name: "Guelma" },
  { code: "25", name: "Constantine" },
  { code: "26", name: "Médéa" },
  { code: "27", name: "Mostaganem" },
  { code: "28", name: "M'Sila" },
  { code: "29", name: "Mascara" },
  { code: "30", name: "Ouargla" },
  { code: "31", name: "Oran" },
  { code: "32", name: "El Bayadh" },
  { code: "33", name: "Illizi" },
  { code: "34", name: "Bordj Bou Arréridj" },
  { code: "35", name: "Boumerdès" },
  { code: "36", name: "El Tarf" },
  { code: "37", name: "Tindouf" },
  { code: "38", name: "Tissemsilt" },
  { code: "39", name: "El Oued" },
  { code: "40", name: "Khenchela" },
  { code: "41", name: "Souk Ahras" },
  { code: "42", name: "Tipaza" },
  { code: "43", name: "Mila" },
  { code: "44", name: "Aïn Defla" },
  { code: "45", name: "Naâma" },
  { code: "46", name: "Aïn Témouchent" },
  { code: "47", name: "Ghardaïa" },
  { code: "48", name: "Relizane" },
  { code: "49", name: "Timimoun" },
  { code: "50", name: "Bordj Badji Mokhtar" },
  { code: "51", name: "Ouled Djellal" },
  { code: "52", name: "Béni Abbès" },
  { code: "53", name: "In Salah" },
  { code: "54", name: "In Guezzam" },
  { code: "55", name: "Touggourt" },
  { code: "56", name: "Djanet" },
  { code: "57", name: "El M'Ghair" },
  { code: "58", name: "El Meniaa" },
];

// Fast O(1) lookup by code
const CODE_TO_NAME = new Map(WILAYA_ENTRIES.map(({ code, name }) => [code, name]));

// Fast O(1) lookup by normalised name (lowercase, no diacritics) for fuzzy parsing
const LOWER_TO_CODE = new Map(
  WILAYA_ENTRIES.map(({ code, name }) => [name.toLowerCase(), code])
);

/**
 * Returns just the wilaya name for a stored code.
 * "16" → "Alger"   |   "" → ""   |   unknown → original value
 */
export function wilayaName(code: string): string {
  if (!code) return "";
  return CODE_TO_NAME.get(code) ?? code;
}

/**
 * Returns "code - name" label for use in inputs and compact displays.
 * "16"          → "16 - Alger"
 * "16 - Alger"  → "16 - Alger"  (passthrough)
 * ""            → ""
 */
export function wilayaLabel(codeOrLabel: string): string {
  if (!codeOrLabel) return "";
  if (codeOrLabel.includes(" - ")) return codeOrLabel; // already a label
  const name = CODE_TO_NAME.get(codeOrLabel);
  return name ? `${codeOrLabel} - ${name}` : codeOrLabel;
}

/**
 * Parses any user-entered format and returns the 2-char code to store.
 *
 * "16"          → "16"
 * "16 - Alger"  → "16"
 * "alger"       → "16"  (case-insensitive name match)
 * "garbage"     → "garbage"  (pass through unchanged)
 */
export function parseWilayaCode(input: string): string {
  if (!input) return "";
  const trimmed = input.trim();

  // Already a 2-digit code
  if (/^\d{2}$/.test(trimmed)) return trimmed;

  // "16 - Alger" or "16-Alger" patterns
  const codeMatch = trimmed.match(/^(\d{2})\s*[-–]/);
  if (codeMatch) return codeMatch[1];

  // Case-insensitive name match
  const byName = LOWER_TO_CODE.get(trimmed.toLowerCase());
  if (byName) return byName;

  return trimmed; // unknown — keep whatever was typed
}
