/**
 * BarcodeSvg — zero-dependency CODE-128C barcode renderer.
 *
 * CODE-128C encodes pairs of digits (00-99) — the most compact encoding for
 * even-length numeric strings. Our auto-generated barcodes are 14 digits,
 * which is exactly what CODE-128C handles.
 *
 * Usage:
 *   <BarcodeSvg value="21308800416797" />
 *   <BarcodeSvg value="21308800416797" height={50} showText={false} />
 */

// ── CODE-128 symbol patterns (11 modules each, index = code value) ──────────
// Index 105 = Start C. Stop is a separate 13-module pattern.

const CODE128: string[] = [
  "11011001100","11001101100","11001100110","10010011000","10010001100", // 0-4
  "10001001100","10011001000","10011000100","10001100100","11001001000", // 5-9
  "11001000100","11000100100","10110011100","10011011100","10011001110", // 10-14
  "10111001100","10011101100","10011100110","11001110010","11001011100", // 15-19
  "11001001110","11011100100","11001110100","11101101110","11101001100", // 20-24
  "11100101100","11100100110","11101100100","11100110100","11100110010", // 25-29
  "11011011000","11011000110","11000110110","10100011000","10001011000", // 30-34
  "10001000110","10110001000","10001101000","10001100010","11010001000", // 35-39
  "11000101000","11000100010","10110111000","10110001110","10001101110", // 40-44
  "10111011000","10111000110","10001110110","11101110110","11010001110", // 45-49
  "11000101110","11011101000","11011100010","11011101110","11101011000", // 50-54
  "11101000110","11100010110","11101101000","11101100010","11100011010", // 55-59
  "11101111010","11001000010","11110001010","10100110000","10100001100", // 60-64
  "10010110000","10010000110","10000101100","10000100110","10110010000", // 65-69
  "10110000100","10011010000","10011000010","10000110100","10000110010", // 70-74
  "11000010010","11001010000","11110111010","11000010100","10001111010", // 75-79
  "10100111100","10010111100","10010011110","10111100100","10011110100", // 80-84
  "10011110010","11110100100","11110010100","11110010010","11011011110", // 85-89
  "11011110110","11110110110","10101111000","10100011110","10001011110", // 90-94
  "10111101000","10111100010","11110101000","11110100010","10111011110", // 95-99
  "10111101110","11101011110","11110101110",                             // 100-102
  "11010000100","11010010000","11010011100",                             // 103=StartA 104=StartB 105=StartC
];
const CODE128_STOP = "1100011101011"; // 13 modules
const START_C = 105;

function encodeCode128C(value: string): string | null {
  if (!value || !(/^\d+$/.test(value)) || value.length % 2 !== 0) return null;

  const pairs: number[] = [];
  for (let i = 0; i < value.length; i += 2) {
    pairs.push(parseInt(value.slice(i, i + 2), 10));
  }

  // Check character: (StartC + Σ position×value) mod 103
  let check = START_C;
  pairs.forEach((v, i) => { check += (i + 1) * v; });
  check %= 103;

  return (
    CODE128[START_C] +
    pairs.map((p) => CODE128[p]).join("") +
    CODE128[check] +
    CODE128_STOP
  );
}

// ── Component ────────────────────────────────────────────────────────────────

interface BarcodeSvgProps {
  value: string;
  /** Bar height in px (default 48) */
  height?: number;
  /** Show numeric text below bars (default true) */
  showText?: boolean;
  /** Extra CSS class on the <svg> element */
  className?: string;
  /** Module (bar unit) width in px (default 1.8) */
  moduleWidth?: number;
}

export default function BarcodeSvg({
  value,
  height = 48,
  showText = true,
  className = "",
  moduleWidth = 1.8,
}: BarcodeSvgProps) {
  const bits = encodeCode128C(value);
  if (!bits || !value) return null;

  const fontSize = 9;
  const textPad = showText ? fontSize + 4 : 0;
  const quietZone = moduleWidth * 10; // CODE-128 spec: 10-module quiet zone
  const totalWidth = bits.length * moduleWidth + quietZone * 2;
  const totalHeight = height + textPad;

  // Build bar rectangles from the bit string
  const bars: { x: number; w: number }[] = [];
  let inBar = false;
  let barStart = 0;
  for (let i = 0; i <= bits.length; i++) {
    const isOne = i < bits.length && bits[i] === "1";
    if (isOne && !inBar) {
      inBar = true;
      barStart = i;
    } else if (!isOne && inBar) {
      inBar = false;
      bars.push({
        x: quietZone + barStart * moduleWidth,
        w: (i - barStart) * moduleWidth,
      });
    }
  }

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${totalWidth} ${totalHeight}`}
      width={totalWidth}
      height={totalHeight}
      className={className}
      style={{ maxWidth: "100%", height: "auto" }}
      role="img"
      aria-label={`Barcode: ${value}`}
    >
      {bars.map((bar, i) => (
        <rect key={i} x={bar.x} y={0} width={bar.w} height={height} fill="currentColor" />
      ))}
      {showText && (
        <text
          x={totalWidth / 2}
          y={totalHeight - 1}
          fontSize={fontSize}
          fontFamily="monospace"
          textAnchor="middle"
          fill="currentColor"
        >
          {value}
        </text>
      )}
    </svg>
  );
}
