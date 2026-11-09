"""
Profile Protocol & Data Structures for the ShoeDZ Agnostic Vision & Spatial OCR Engine.
Allows any domain utility (Purchase Orders, Supplier Invoices, Stocktake Sheets,
Expense Receipts, Cheques) to inject its own keywords, columns, and field parsers.
"""
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional


@dataclass
class OCRToken:
    """
    A single detected text region from the OCR engine with normalized bounding-box
    coordinates [x1, y1, x2, y2] and original 4-point polygon.
    """
    text: str
    bbox: List[float]  # [x1, y1, x2, y2]
    confidence: float = 1.0
    polygon: Optional[List[List[float]]] = None

    @property
    def x1(self) -> float:
        return float(self.bbox[0])

    @property
    def y1(self) -> float:
        return float(self.bbox[1])

    @property
    def x2(self) -> float:
        return float(self.bbox[2])

    @property
    def y2(self) -> float:
        return float(self.bbox[3])

    @property
    def cx(self) -> float:
        return (self.x1 + self.x2) / 2.0

    @property
    def cy(self) -> float:
        return (self.y1 + self.y2) / 2.0

    @property
    def width(self) -> float:
        return max(0.0, self.x2 - self.x1)

    @property
    def height(self) -> float:
        return max(0.0, self.y2 - self.y1)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "text": self.text,
            "bbox": [round(c, 1) for c in self.bbox],
            "confidence": round(float(self.confidence), 4),
            "polygon": self.polygon,
        }


@dataclass
class ColumnDefinition:
    """
    Defines a single table column in an ExtractionProfile.
    - key: canonical field key in parsed row dicts (e.g. 'reference', 'quantity', 'unit_price')
    - synonyms: list of header keywords/variants matching this column
    - extractor: callable that converts raw cell string into a typed value
    - required: whether a valid body row should generally contain this column
    - align: expected text alignment ('left', 'center', 'right')
    - label: optional human-readable label for UI metadata
    """
    key: str
    synonyms: List[str]
    extractor: Callable[[Any], Any] = str
    required: bool = False
    align: str = "left"
    label: str = ""


@dataclass
class FieldExtractionRule:
    """
    Defines how to extract a metadata field (in header) or summary total (in footer)
    outside the main table body.
    - key: canonical field name
    - keywords: list of anchor labels or regex patterns (e.g. ['Date', 'Le'], ['Total HT', 'Net à payer'])
    - extractor: callable to parse the value following the keyword
    """
    key: str
    keywords: List[str] = field(default_factory=list)
    extractor: Callable[[Any], Any] = str
    regex: Optional[str] = None


@dataclass
class ExtractionProfile:
    """
    Domain-specific configuration injected into ProfileDocumentParser.
    Nothing in DocumentScanEngine or ProfileDocumentParser is hardcoded to footwear or POs.
    """
    name: str
    header_anchors: List[str]
    columns: List[ColumnDefinition]
    header_fields: Dict[str, FieldExtractionRule] = field(default_factory=dict)
    footer_fields: Dict[str, FieldExtractionRule] = field(default_factory=dict)
    row_grammar_fallback: Optional[Callable[[str], Optional[Dict[str, Any]]]] = None
    row_post_processor: Optional[Callable[[Dict[str, Any]], Optional[Dict[str, Any]]]] = None

