"""Shared utility for parsing CSV / XLSX uploads into a list of dicts."""
import csv
import io


def parse_upload(file_obj):
    """
    Parse an uploaded file (CSV or XLSX) into (rows, error).

    rows  — list of dicts; keys are lowercased, stripped header values.
    error — non-None string when the file cannot be parsed at all.
    """
    name = getattr(file_obj, "name", "").lower()
    raw = file_obj.read()

    if name.endswith(".xlsx"):
        return _parse_xlsx(raw)
    return _parse_csv(raw)


def _parse_csv(raw_bytes):
    try:
        text = raw_bytes.decode("utf-8-sig")   # handles BOM from Excel "Save as CSV"
    except UnicodeDecodeError:
        text = raw_bytes.decode("latin-1")

    reader = csv.DictReader(io.StringIO(text))
    try:
        rows = [
            {k.strip().lower(): (v or "").strip() for k, v in row.items() if k}
            for row in reader
        ]
    except Exception as exc:
        return [], f"Erreur de lecture CSV : {exc}"
    return rows, None


def _parse_xlsx(raw_bytes):
    try:
        import openpyxl
    except ImportError:
        return [], "openpyxl n'est pas installé (pip install openpyxl)."

    try:
        wb = openpyxl.load_workbook(io.BytesIO(raw_bytes), read_only=True, data_only=True)
        ws = wb.active
        rows_iter = ws.iter_rows(values_only=True)
        headers = [str(h).strip().lower() if h is not None else "" for h in next(rows_iter)]
        rows = []
        for row in rows_iter:
            d = {h: (str(v).strip() if v is not None else "") for h, v in zip(headers, row) if h}
            rows.append(d)
        return rows, None
    except StopIteration:
        return [], "Le fichier est vide."
    except Exception as exc:
        return [], f"Erreur de lecture XLSX : {exc}"
