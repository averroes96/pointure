"""
Layer 1 — Profile-Driven Spatial Table & Document Parser (`ProfileDocumentParser`).
Takes raw spatial OCRTokens from DocumentScanEngine and an injected ExtractionProfile:
  1. Locates the table header row using `header_anchors` and column synonyms.
  2. Computes column X-boundaries from header token horizontal projections.
  3. Assigns cell tokens to columns via bounding-box horizontal intersection/center.
  4. Applies each column's injected `extractor` function.
  5. Extracts outside-table `metadata` (header_fields) and `totals` (footer_fields).
"""
import re
from typing import Any, Dict, List, Optional, Tuple

from apps.core.services.ocr.engine import DocumentScanEngine
from apps.core.services.ocr.extractors import normalize_ocr_label
from apps.core.services.ocr.schema import (
    ColumnDefinition,
    ExtractionProfile,
    FieldExtractionRule,
    OCRToken,
)


class ProfileDocumentParser:
    """
    Domain-agnostic spatial parser driven entirely by an injected ExtractionProfile.
    """

    def __init__(self, engine: Optional[DocumentScanEngine] = None):
        self.engine = engine or DocumentScanEngine()

    @staticmethod
    def match_token_to_column(
        text: str,
        columns: List[ColumnDefinition],
        already_matched: Optional[set] = None,
    ) -> Optional[ColumnDefinition]:
        """
        Matches a candidate header token string to a ColumnDefinition via its synonyms.
        """
        norm = normalize_ocr_label(text)
        if not norm:
            return None

        # 1. Exact synonym match
        for col in columns:
            if already_matched and col.key in already_matched:
                continue
            if norm == normalize_ocr_label(col.key):
                return col
            for syn in col.synonyms:
                if norm == normalize_ocr_label(syn):
                    return col

        # 2. Substring match for longer synonyms (>= 3 chars)
        for col in columns:
            if already_matched and col.key in already_matched:
                continue
            for syn in col.synonyms:
                syn_norm = normalize_ocr_label(syn)
                if len(syn_norm) >= 3 and (syn_norm in norm or (len(norm) >= 3 and norm in syn_norm)):
                    return col

        return None

    @classmethod
    def expand_merged_header_row(
        cls,
        row: List[OCRToken],
        profile: ExtractionProfile,
    ) -> List[Tuple[ColumnDefinition, OCRToken]]:
        """
        Given a candidate header row, matches tokens to ColumnDefinitions.
        If a single wide token contains multiple column headers (because RapidOCR
        merged a horizontal line into one box), splits it proportionally into virtual
        header tokens so X-boundaries can still be computed accurately.
        """
        direct_matches: List[Tuple[ColumnDefinition, OCRToken]] = []
        used_keys: set = set()

        for tok in row:
            col = cls.match_token_to_column(tok.text, profile.columns, already_matched=used_keys)
            if col:
                direct_matches.append((col, tok))
                used_keys.add(col.key)

        if len(direct_matches) >= 2:
            direct_matches.sort(key=lambda item: item[1].x1)
            return direct_matches

        # Check if a wide token contains multiple column synonyms
        expanded_matches: List[Tuple[ColumnDefinition, OCRToken]] = []
        used_keys.clear()

        for tok in row:
            raw_text = tok.text
            norm_full = normalize_ocr_label(raw_text)
            if not norm_full:
                continue

            found_in_tok: List[Tuple[int, int, ColumnDefinition, str]] = []
            for col in profile.columns:
                if col.key in used_keys:
                    continue
                best_span: Optional[Tuple[int, int, str]] = None
                # Sort synonyms longest first to prefer 'prix unitaire' over 'prix'
                sorted_syns = sorted(col.synonyms, key=lambda s: len(s), reverse=True)
                for syn in sorted_syns:
                    syn_norm = normalize_ocr_label(syn)
                    if not syn_norm:
                        continue
                    # Word-boundary search in normalized string
                    pattern = r"(?:^|\b)" + re.escape(syn_norm) + r"(?:\b|$)"
                    m = re.search(pattern, norm_full)
                    if m:
                        start_idx, end_idx = m.span()
                        best_span = (start_idx, end_idx, syn)
                        break
                if best_span:
                    found_in_tok.append((best_span[0], best_span[1], col, best_span[2]))
                    used_keys.add(col.key)

            if len(found_in_tok) >= 2:
                found_in_tok.sort(key=lambda x: x[0])
                total_len = max(1, len(norm_full))
                for start_idx, end_idx, col, matched_syn in found_in_tok:
                    vx1 = tok.x1 + (start_idx / total_len) * tok.width
                    vx2 = tok.x1 + (end_idx / total_len) * tok.width
                    vtok = OCRToken(
                        text=matched_syn,
                        bbox=[round(vx1, 1), tok.y1, round(vx2, 1), tok.y2],
                        confidence=tok.confidence,
                        polygon=tok.polygon,
                    )
                    expanded_matches.append((col, vtok))
            elif len(found_in_tok) == 1:
                _, _, col, _ = found_in_tok[0]
                expanded_matches.append((col, tok))

        expanded_matches.sort(key=lambda item: item[1].x1)
        return expanded_matches

    @classmethod
    def detect_header_row(
        cls,
        rows: List[List[OCRToken]],
        profile: ExtractionProfile,
    ) -> Tuple[int, List[Tuple[ColumnDefinition, OCRToken]]]:
        """
        Finds the row index that best matches the profile's `header_anchors` and `columns`.
        Returns (header_row_index, matched_column_tokens).
        Returns (-1, []) if no plausible header row is found.
        """
        best_idx = -1
        best_score = 0
        best_matches: List[Tuple[ColumnDefinition, OCRToken]] = []

        anchor_norms = [normalize_ocr_label(a) for a in profile.header_anchors if a]

        for idx, row in enumerate(rows):
            row_text_norm = normalize_ocr_label(" ".join(t.text for t in row))
            if not row_text_norm:
                continue

            col_matches = cls.expand_merged_header_row(row, profile)
            anchor_hits = sum(1 for a in anchor_norms if a and a in row_text_norm)

            score = (len(col_matches) * 10) + (anchor_hits * 3)
            if len(col_matches) >= 2 and score > best_score:
                best_score = score
                best_idx = idx
                best_matches = col_matches

        return best_idx, best_matches

    @staticmethod
    def compute_column_boundaries(
        matched_headers: List[Tuple[ColumnDefinition, OCRToken]],
        max_x: float = 10000.0,
    ) -> List[Dict[str, Any]]:
        """
        Computes horizontal X-boundaries [x_min, x_max] for each detected table column
        using the horizontal projections of the header tokens and midpoints between neighbors.
        """
        if not matched_headers:
            return []

        sorted_headers = sorted(matched_headers, key=lambda item: item[1].cx)
        bounds: List[Dict[str, Any]] = []
        n = len(sorted_headers)

        for i, (col_def, tok) in enumerate(sorted_headers):
            if i == 0:
                x_min = 0.0
            else:
                prev_tok = sorted_headers[i - 1][1]
                # If tokens overlap slightly, use midpoint of centers; otherwise midpoint of gap
                if prev_tok.x2 <= tok.x1:
                    x_min = (prev_tok.x2 + tok.x1) / 2.0
                else:
                    x_min = (prev_tok.cx + tok.cx) / 2.0

            if i == n - 1:
                x_max = max(max_x, tok.x2 + 1000.0)
            else:
                next_tok = sorted_headers[i + 1][1]
                if tok.x2 <= next_tok.x1:
                    x_max = (tok.x2 + next_tok.x1) / 2.0
                else:
                    x_max = (tok.cx + next_tok.cx) / 2.0

            bounds.append({
                "key": col_def.key,
                "column": col_def,
                "header_token": tok,
                "x_min": round(x_min, 2),
                "x_max": round(x_max, 2),
                "center_x": round(tok.cx, 2),
            })

        return bounds

    @staticmethod
    def assign_token_to_column(
        token: OCRToken,
        column_bounds: List[Dict[str, Any]],
    ) -> Optional[str]:
        """
        Assigns a cell token to a column key based on horizontal bounding-box intersection
        and center proximity.
        """
        if not column_bounds:
            return None

        # 1. Check horizontal intersection overlap
        best_key = None
        best_overlap = 0.0

        for b in column_bounds:
            overlap = max(0.0, min(token.x2, b["x_max"]) - max(token.x1, b["x_min"]))
            if overlap > best_overlap:
                best_overlap = overlap
                best_key = b["key"]

        if best_key is not None and best_overlap > 0:
            return best_key

        # 2. Fallback: check which column boundary contains token center cx
        for b in column_bounds:
            if b["x_min"] <= token.cx <= b["x_max"]:
                return b["key"]

        # 3. Nearest column center
        nearest = min(column_bounds, key=lambda b: abs(token.cx - b["center_x"]))
        return nearest["key"]

    @staticmethod
    def is_footer_row(row: List[OCRToken], profile: ExtractionProfile) -> bool:
        """
        Checks if a row marks the start of the footer summary section (e.g. 'Total HT', 'Net à payer').
        """
        if not profile.footer_fields:
            return False
        row_text_norm = normalize_ocr_label(" ".join(t.text for t in row))
        if not row_text_norm:
            return False

        for rule in profile.footer_fields.values():
            for kw in rule.keywords:
                kw_norm = normalize_ocr_label(kw)
                if kw_norm and kw_norm in row_text_norm:
                    # Ensure it's near the start of a token or a standalone label, not inside a product name
                    if re.search(r"(?:^|\b)" + re.escape(kw_norm) + r"(?:\b|$)", row_text_norm):
                        return True
        return False

    @staticmethod
    def extract_field_rules(
        rows: List[List[OCRToken]],
        rules: Dict[str, FieldExtractionRule],
    ) -> Dict[str, Any]:
        """
        Extracts key-value fields from header or footer rows using FieldExtractionRule definitions.
        """
        results: Dict[str, Any] = {}
        if not rules or not rows:
            return results

        full_lines = [" ".join(t.text for t in r).strip() for r in rows if r]

        for field_key, rule in rules.items():
            extracted_val = None

            # 1. If explicit regex is configured on rule
            if rule.regex:
                for line in full_lines:
                    m = re.search(rule.regex, line, flags=re.IGNORECASE)
                    if m:
                        candidate = m.group(1) if m.lastindex else m.group(0)
                        extracted_val = rule.extractor(candidate)
                        if extracted_val is not None and extracted_val != "":
                            break

            # 2. Keyword anchor matching
            if extracted_val is None and rule.keywords:
                for line in full_lines:
                    line_norm = normalize_ocr_label(line)
                    for kw in rule.keywords:
                        kw_norm = normalize_ocr_label(kw)
                        if not kw_norm or kw_norm not in line_norm:
                            continue
                        # Find the keyword in original line (case-insensitive) and take trailing text
                        m = re.search(re.escape(kw) + r"[\s:\-\.]*(.+)$", line, flags=re.IGNORECASE)
                        candidate = m.group(1).strip() if m else line
                        val = rule.extractor(candidate)
                        if val is not None and val != "":
                            extracted_val = val
                            break
                    if extracted_val is not None and extracted_val != "":
                        break

            if extracted_val is not None and extracted_val != "":
                results[field_key] = extracted_val

        return results

    def parse_tokens(
        self,
        tokens: List[OCRToken],
        profile: ExtractionProfile,
        image_meta: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Core parsing pipeline taking spatial OCRTokens and an ExtractionProfile.
        Returns standardized dictionary:
          {
            "profile": profile.name,
            "metadata": {...},
            "rows": [...],
            "totals": {...},
            "image_meta": {...},
            "tokens": [...],
            "column_bounds": [...]
          }
        """
        image_meta = image_meta or {}
        max_x = float(image_meta.get("width") or 2000.0)

        rows = self.engine.cluster_rows(tokens)
        if not rows:
            return {
                "profile": profile.name,
                "metadata": {},
                "rows": [],
                "totals": {},
                "image_meta": image_meta,
                "tokens": [],
                "column_bounds": [],
            }

        header_idx, matched_headers = self.detect_header_row(rows, profile)
        column_bounds = self.compute_column_boundaries(matched_headers, max_x=max_x)
        col_map: Dict[str, ColumnDefinition] = {c.key: c for c in profile.columns}

        if header_idx >= 0:
            header_rows = rows[:header_idx]
            candidate_body_rows = rows[header_idx + 1 :]
        else:
            # No explicit header row detected: treat top 20% as potential metadata and try grammar on all rows
            split_at = max(1, int(len(rows) * 0.2)) if len(rows) > 3 else 0
            header_rows = rows[:split_at]
            candidate_body_rows = rows

        body_rows: List[List[OCRToken]] = []
        footer_rows: List[List[OCRToken]] = []
        in_footer = False

        for r in candidate_body_rows:
            if not in_footer and self.is_footer_row(r, profile):
                in_footer = True
            if in_footer:
                footer_rows.append(r)
            else:
                body_rows.append(r)

        # Extract header metadata & footer totals
        metadata = self.extract_field_rules(header_rows, profile.header_fields)
        totals = self.extract_field_rules(footer_rows, profile.footer_fields)

        parsed_rows: List[Dict[str, Any]] = []

        for row_idx, row_tokens in enumerate(body_rows):
            if not row_tokens:
                continue

            row_x1 = min(t.x1 for t in row_tokens)
            row_y1 = min(t.y1 for t in row_tokens)
            row_x2 = max(t.x2 for t in row_tokens)
            row_y2 = max(t.y2 for t in row_tokens)
            row_bbox = [round(row_x1, 1), round(row_y1, 1), round(row_x2, 1), round(row_y2, 1)]
            avg_conf = sum(t.confidence for t in row_tokens) / len(row_tokens)
            full_row_text = " ".join(t.text for t in row_tokens).strip()

            # Sub-segment any wide tokens that have multi-space gaps
            effective_tokens: List[OCRToken] = []
            for tok in row_tokens:
                effective_tokens.extend(self.engine.split_wide_token(tok))

            raw_cells: Dict[str, List[str]] = {c.key: [] for c in profile.columns}
            if column_bounds and len(effective_tokens) >= 2:
                for tok in effective_tokens:
                    col_key = self.assign_token_to_column(tok, column_bounds)
                    if col_key and col_key in raw_cells:
                        raw_cells[col_key].append(tok.text)

            populated_cols = sum(1 for vals in raw_cells.values() if vals)
            row_data: Dict[str, Any] = {}

            # If tokens aligned into >= 2 columns, apply each column's extractor
            if populated_cols >= 2:
                for col_def in profile.columns:
                    raw_str = " ".join(raw_cells.get(col_def.key, [])).strip()
                    row_data[col_def.key] = col_def.extractor(raw_str) if raw_str else None

            # If row was a single merged token (or < 2 columns populated) or missing key fields,
            # allow profile's row_grammar_fallback to parse or enrich the row
            if profile.row_grammar_fallback:
                needs_fallback = populated_cols < 2 or all(
                    row_data.get(c.key) in (None, "", 0) for c in profile.columns if c.required
                )
                if needs_fallback:
                    fallback_data = profile.row_grammar_fallback(full_row_text)
                    if fallback_data:
                        for k, v in fallback_data.items():
                            if v is not None and v != "" and row_data.get(k) in (None, "", 0):
                                row_data[k] = v

            # Skip completely empty/noise rows
            non_empty_vals = [
                v for k, v in row_data.items()
                if k in col_map and v is not None and v != "" and v != 0
            ]
            if not non_empty_vals:
                continue

            row_data["_bbox"] = row_bbox
            row_data["_confidence"] = round(avg_conf, 4)
            row_data["_raw_text"] = full_row_text
            row_data["_row_index"] = row_idx + 1

            if profile.row_post_processor:
                processed = profile.row_post_processor(row_data)
                if processed is None:
                    continue
                row_data = processed

            parsed_rows.append(row_data)

        return {
            "profile": profile.name,
            "metadata": metadata,
            "rows": parsed_rows,
            "totals": totals,
            "image_meta": image_meta,
            "tokens": [t.to_dict() for t in tokens],
            "column_bounds": [
                {
                    "key": b["key"],
                    "x_min": b["x_min"],
                    "x_max": b["x_max"],
                    "center_x": b["center_x"],
                }
                for b in column_bounds
            ],
        }

    def scan_and_parse(
        self,
        image_input: Any,
        profile: ExtractionProfile,
        deskew: bool = True,
    ) -> Dict[str, Any]:
        """
        End-to-end convenience method: runs DocumentScanEngine.extract_tokens
        and parses the spatial tokens with the injected ExtractionProfile.
        """
        tokens, image_meta = self.engine.extract_tokens(image_input, deskew=deskew)
        return self.parse_tokens(tokens, profile, image_meta=image_meta)

