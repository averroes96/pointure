import re
import io
import PyPDF2

def parse_supplier_invoice(pdf_file):
    """
    Parses the specific tabular format:
    [Optional Supplier Number+Name] [Item no] [Size] [Ctns/pair's] [Ctns] [pairs] [price] [amount] [deposit] [shop]
    
    Example:
    1朵儿诗 R42-32 37-41 10c/15p 150 42
    Y-28A 36-40 12c/20p 96 240 38.5 57660 10000
    """
    reader = PyPDF2.PdfReader(pdf_file)
    text = ""
    for page in reader.pages:
        text += page.extract_text() + "\n"

    lines = []
    
    pattern = re.compile(
        r'(?:(?:\d+[^\s]+)\s+)?'             # Optional supplier name (e.g., 1朵儿诗)
        r'([A-Za-z0-9\-仿]+)\s+'            # Item No (Group 1)
        r'(\d{2})-(\d{2})\s+'                 # Size From-To (Group 2, 3)
        r'(\d+)c/(\d+)p\s+'                   # Cartons / PairsPerCtn (Group 4, 5)
        r'(?:\d+\s+)?'                        # Optional block carton sum (e.g., 78 or 96)
        r'(\d+)\s+'                           # Total Pairs (Group 6)
        r'([\d\.]+)'                          # Price (Group 7)
    )
    
    for row in text.split('\n'):
        row = row.strip()
        if not row:
            continue
            
        match = pattern.search(row)
        if match:
            item_no = match.group(1)
            size_from = int(match.group(2))
            size_to = int(match.group(3))
            cartons = int(match.group(4))
            pairs_per_ctn = int(match.group(5))
            total_pairs = int(match.group(6))
            price = match.group(7)
            
            lines.append({
                "reference": item_no,
                "size_from": size_from,
                "size_to": size_to,
                "cartons": cartons,
                "pairs_per_carton": pairs_per_ctn,
                "price": price,
            })

    return {"lines": lines}
