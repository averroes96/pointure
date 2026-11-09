"""
Demo Fixtures Generator for ShoeDZ (Pointure).

Generates synthetic, fully anonymized demo datasets and import fixtures:
1. Legacy dBase III (.DBF) files matching Algerian shoe store heritage formats:
   - CLIENT.DBF, FOURNISS.DBF, ARTICLE.DBF, FAMILLE.DBF, CHEQUEXP.DBF, CREANCE.DBF, GCPARAM.DBF
2. Purchase Order import files:
   - French Excel (.xlsx) & CSV (.csv)
   - Arabic Excel (.xlsx) CP1256/UTF-8
   - English Pivot Matrix Excel (.xlsx)
3. Product catalog import files:
   - Excel (.xlsx) & CSV (.csv) for mass catalog loading.
4. Comprehensive README.md guide for demonstration and testing.
"""

import csv
import datetime
from decimal import Decimal
import os
from pathlib import Path
import struct
from typing import Any, Dict, List, Optional

try:
    import openpyxl
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
except ImportError:
    openpyxl = None


# ─────────────────────────────────────────────────────────────────────────────
# 1. Pure-Python dBase III Binary File Writer
# ─────────────────────────────────────────────────────────────────────────────

def write_dbf(filepath: str, fields: List[Dict[str, Any]], records: List[Dict[str, Any]], encoding: str = "cp850") -> None:
    """
    Writes a standard dBase III (.dbf) binary file without memo dependencies.
    Compatible with dbfread, shapely, LibreOffice, and ShoeDZ LegacyDBFImporter.

    fields structure:
      [
        {"name": "CLIENT", "type": "C", "length": 10},
        {"name": "MT_RESTE", "type": "N", "length": 12, "decimal": 2},
        {"name": "JOUR", "type": "D", "length": 8},
      ]
    """
    num_fields = len(fields)
    header_len = 32 + (32 * num_fields) + 1
    record_len = 1 + sum(int(f["length"]) for f in fields)
    num_records = len(records)
    today = datetime.date.today()

    os.makedirs(os.path.dirname(filepath), exist_ok=True)

    with open(filepath, "wb") as f:
        # 1. Main Header (32 bytes)
        # Byte 0: 0x03 = dBASE III without memo
        # Bytes 1-3: YY MM DD
        # Bytes 4-7: Record count (uint32 little endian)
        # Bytes 8-9: Header length (uint16 little endian)
        # Bytes 10-11: Record length (uint16 little endian)
        # Bytes 12-31: Reserved (20 bytes zeros)
        f.write(struct.pack(
            "<BBBBIHH20s",
            0x03,
            max(0, today.year - 1900) % 256,
            today.month,
            today.day,
            num_records,
            header_len,
            record_len,
            b"\x00" * 20,
        ))

        # 2. Field Descriptors (32 bytes per field)
        for field in fields:
            name_bytes = field["name"].upper().encode("ascii")[:10].ljust(11, b"\x00")
            f_type = field["type"].upper().encode("ascii")[:1]
            f_len = int(field["length"])
            f_dec = int(field.get("decimal", 0))

            f.write(struct.pack(
                "<11sc4sBB14s",
                name_bytes,
                f_type,
                b"\x00" * 4,
                f_len,
                f_dec,
                b"\x00" * 14,
            ))

        # 3. Header Terminator (0x0D)
        f.write(b"\x0D")

        # 4. Data Records
        for rec in records:
            # Leading 0x20 space = active record (not deleted)
            f.write(b" ")
            for field in fields:
                val = rec.get(field["name"])
                flen = int(field["length"])
                ftype = field["type"].upper()

                if ftype == "N":
                    if val is None or val == "":
                        val_str = ""
                    elif isinstance(val, (int, float, Decimal)):
                        dec = int(field.get("decimal", 0))
                        if dec > 0:
                            val_str = f"{float(val):.{dec}f}"
                        else:
                            val_str = str(int(val))
                    else:
                        val_str = str(val).strip()
                    val_bytes = val_str.rjust(flen)[:flen].encode(encoding, errors="replace")

                elif ftype == "D":
                    if isinstance(val, (datetime.date, datetime.datetime)):
                        val_str = val.strftime("%Y%m%d")
                    else:
                        val_str = str(val or "").replace("-", "")[:8]
                    val_bytes = val_str.ljust(flen)[:flen].encode(encoding, errors="replace")

                elif ftype == "L":
                    if val in (True, 1, "T", "t", "Y", "y", "O", "o"):
                        val_bytes = b"T"
                    elif val in (False, 0, "F", "f", "N", "n"):
                        val_bytes = b"F"
                    else:
                        val_bytes = b"?"
                    val_bytes = val_bytes.ljust(flen)[:flen]

                else:  # "C" or default
                    val_str = str(val if val is not None else "")
                    val_bytes = val_str.encode(encoding, errors="replace").ljust(flen)[:flen]

                f.write(val_bytes)

        # 5. EOF marker (0x1A)
        f.write(b"\x1A")


# ─────────────────────────────────────────────────────────────────────────────
# 2. Synthetic Data Generators
# ─────────────────────────────────────────────────────────────────────────────

def get_legacy_dbf_synthetic_dataset() -> Dict[str, Dict[str, Any]]:
    """Returns synthetic datasets tailored for ShoeDZ Legacy DBF import engine."""
    today = datetime.date.today()

    return {
        "CLIENT.DBF": {
            "fields": [
                {"name": "CLIENT", "type": "C", "length": 10},
                {"name": "DESIGNAT", "type": "C", "length": 40},
                {"name": "TEL1", "type": "C", "length": 15},
                {"name": "ADRESSE", "type": "C", "length": 50},
                {"name": "MT_RESTE", "type": "N", "length": 12, "decimal": 2},
                {"name": "JOUR", "type": "D", "length": 8},
                {"name": "CODE_TARIF", "type": "C", "length": 2},
                {"name": "IFISC", "type": "C", "length": 20},
                {"name": "REG_COM", "type": "C", "length": 30},
            ],
            "records": [
                {
                    "CLIENT": "CLT001",
                    "DESIGNAT": "Boutique El Amine Gros",
                    "TEL1": "0555112233",
                    "ADRESSE": "14 Rue Larbi Ben M'hidi, Alger",
                    "MT_RESTE": Decimal("125000.00"),
                    "JOUR": today - datetime.timedelta(days=12),
                    "CODE_TARIF": "3",
                    "IFISC": "001616012345678",
                    "REG_COM": "16/00-0987654B20",
                },
                {
                    "CLIENT": "CLT002",
                    "DESIGNAT": "Chaussures Didouche Demi-Gros",
                    "TEL1": "0555445566",
                    "ADRESSE": "48 Rue Didouche Mourad, Alger",
                    "MT_RESTE": Decimal("45000.00"),
                    "JOUR": today - datetime.timedelta(days=5),
                    "CODE_TARIF": "2",
                    "IFISC": "001616098765432",
                    "REG_COM": "16/00-0123456B21",
                },
                {
                    "CLIENT": "CLT003",
                    "DESIGNAT": "Mode & Sport Plus",
                    "TEL1": "0555778899",
                    "ADRESSE": "Centre Commercial Bab Ezzouar, Alger",
                    "MT_RESTE": Decimal("0.00"),
                    "JOUR": today - datetime.timedelta(days=20),
                    "CODE_TARIF": "1",
                    "IFISC": "",
                    "REG_COM": "",
                },
                {
                    "CLIENT": "CLT004",
                    "DESIGNAT": "Ets Benali & Frères Gros",
                    "TEL1": "0550123456",
                    "ADRESSE": "Zone d'Activité, Bordj Bou Arreridj",
                    "MT_RESTE": Decimal("320000.00"),
                    "JOUR": today - datetime.timedelta(days=2),
                    "CODE_TARIF": "3",
                    "IFISC": "003434011223344",
                    "REG_COM": "34/00-0554433B19",
                },
                {
                    "CLIENT": "CLT005",
                    "DESIGNAT": "Comptoir Chaussures Oranais",
                    "TEL1": "0560987654",
                    "ADRESSE": "22 Boulevard Front de Mer, Oran",
                    "MT_RESTE": Decimal("-18000.00"),  # Avoir / credit client
                    "JOUR": today - datetime.timedelta(days=15),
                    "CODE_TARIF": "2",
                    "IFISC": "003131055667788",
                    "REG_COM": "31/00-0778899B22",
                },
                {
                    "CLIENT": "CLT006",
                    "DESIGNAT": "Tendances Footwear Blida",
                    "TEL1": "0555001122",
                    "ADRESSE": "Place du 1er Novembre, Blida",
                    "MT_RESTE": Decimal("8500.00"),
                    "JOUR": today - datetime.timedelta(days=8),
                    "CODE_TARIF": "1",
                    "IFISC": "",
                    "REG_COM": "",
                },
                {
                    "CLIENT": "CLT007",
                    "DESIGNAT": "Sarl Footwear Distribution Constantine",
                    "TEL1": "0540112233",
                    "ADRESSE": "Zone Industrielle Le Palma, Constantine",
                    "MT_RESTE": Decimal("210000.00"),
                    "JOUR": today - datetime.timedelta(days=1),
                    "CODE_TARIF": "3",
                    "IFISC": "002525044332211",
                    "REG_COM": "25/00-0112233B18",
                },
                {
                    "CLIENT": "CLT008",
                    "DESIGNAT": "Boutique Le Confort Tlemcen",
                    "TEL1": "0551223344",
                    "ADRESSE": "Avenue Khemisti, Tlemcen",
                    "MT_RESTE": Decimal("12000.00"),
                    "JOUR": today - datetime.timedelta(days=10),
                    "CODE_TARIF": "2",
                    "IFISC": "001313099887766",
                    "REG_COM": "13/00-0334455B23",
                },
            ],
        },
        "FOURNISS.DBF": {
            "fields": [
                {"name": "CODE_FOURN", "type": "C", "length": 10},
                {"name": "RAISON", "type": "C", "length": 40},
                {"name": "TELEPHONE", "type": "C", "length": 15},
                {"name": "ADRESSE", "type": "C", "length": 50},
                {"name": "MT_RESTE", "type": "N", "length": 12, "decimal": 2},
                {"name": "JOUR", "type": "D", "length": 8},
            ],
            "records": [
                {
                    "CODE_FOURN": "FRN001",
                    "RAISON": "Sarl El Eulma Import Chaussures",
                    "TELEPHONE": "036881122",
                    "ADRESSE": "Rue Dubai, El Eulma, Sétif",
                    "MT_RESTE": Decimal("480000.00"),
                    "JOUR": today - datetime.timedelta(days=15),
                },
                {
                    "CODE_FOURN": "FRN002",
                    "RAISON": "Manufacture Cuir Tlemcen",
                    "TELEPHONE": "043201530",
                    "ADRESSE": "Zone Industrielle Chetouane, Tlemcen",
                    "MT_RESTE": Decimal("150000.00"),
                    "JOUR": today - datetime.timedelta(days=7),
                },
                {
                    "CODE_FOURN": "FRN003",
                    "RAISON": "Distribution Sportwear Alger",
                    "TELEPHONE": "023554433",
                    "ADRESSE": "Zone d'Activité Dar El Beida, Alger",
                    "MT_RESTE": Decimal("-25000.00"),  # Avoir fournisseur
                    "JOUR": today - datetime.timedelta(days=3),
                },
                {
                    "CODE_FOURN": "FRN004",
                    "RAISON": "Atelier Artisanat & Bottine Blida",
                    "TELEPHONE": "025401122",
                    "ADRESSE": "Boulevard des Martyrs, Blida",
                    "MT_RESTE": Decimal("0.00"),
                    "JOUR": today - datetime.timedelta(days=30),
                },
            ],
        },
        "FAMILLE.DBF": {
            "fields": [
                {"name": "FAMILLE", "type": "C", "length": 10},
                {"name": "LIBELLE", "type": "C", "length": 30},
            ],
            "records": [
                {"FAMILLE": "HOM", "LIBELLE": "Chaussures Homme Classique"},
                {"FAMILLE": "FEM", "LIBELLE": "Chaussures Femme & Soirée"},
                {"FAMILLE": "SPORT", "LIBELLE": "Basket & Sportwear"},
                {"FAMILLE": "ENF", "LIBELLE": "Chaussures Enfant"},
                {"FAMILLE": "VILLE", "LIBELLE": "Mocassin & Ville"},
            ],
        },
        "ARTICLE.DBF": {
            "fields": [
                {"name": "ARTICLE", "type": "C", "length": 10},
                {"name": "REFERENCE", "type": "C", "length": 20},
                {"name": "LIBELLE", "type": "C", "length": 40},
                {"name": "FAMILLE", "type": "C", "length": 10},
                {"name": "NOMBRE", "type": "N", "length": 6, "decimal": 0},
                {"name": "PRIX_ACHAT", "type": "N", "length": 10, "decimal": 2},
                {"name": "BTARIF1", "type": "N", "length": 10, "decimal": 2},
                {"name": "BTARIF2", "type": "N", "length": 10, "decimal": 2},
                {"name": "BTARIF3", "type": "N", "length": 10, "decimal": 2},
                {"name": "ST_BL", "type": "N", "length": 6, "decimal": 0},
                {"name": "POINTURE", "type": "C", "length": 10},
                {"name": "CASIER", "type": "C", "length": 15},
            ],
            "records": [
                {
                    "ARTICLE": "A001",
                    "REFERENCE": "BSK-AIR-10",
                    "LIBELLE": "Basket Air Pro Running",
                    "FAMILLE": "SPORT",
                    "NOMBRE": 12,
                    "PRIX_ACHAT": Decimal("2800.00"),
                    "BTARIF1": Decimal("4800.00"),
                    "BTARIF2": Decimal("4200.00"),
                    "BTARIF3": Decimal("3600.00"),
                    "ST_BL": 48,
                    "POINTURE": "39/44",
                    "CASIER": "C20",
                },
                {
                    "ARTICLE": "A002",
                    "REFERENCE": "BOT-CUI-22",
                    "LIBELLE": "Bottine Cuir Hiver Homme",
                    "FAMILLE": "HOM",
                    "NOMBRE": 10,
                    "PRIX_ACHAT": Decimal("3500.00"),
                    "BTARIF1": Decimal("6200.00"),
                    "BTARIF2": Decimal("5400.00"),
                    "BTARIF3": Decimal("4800.00"),
                    "ST_BL": 30,
                    "POINTURE": "40/45",
                    "CASIER": "R12",
                },
                {
                    "ARTICLE": "A003",
                    "REFERENCE": "MOC-CLA-05",
                    "LIBELLE": "Mocassin Ville Cuir Souple",
                    "FAMILLE": "VILLE",
                    "NOMBRE": 10,
                    "PRIX_ACHAT": Decimal("2200.00"),
                    "BTARIF1": Decimal("4200.00"),
                    "BTARIF2": Decimal("3600.00"),
                    "BTARIF3": Decimal("3100.00"),
                    "ST_BL": 40,
                    "POINTURE": "39/44",
                    "CASIER": "A05",
                },
                {
                    "ARTICLE": "A004",
                    "REFERENCE": "SAN-ETE-12",
                    "LIBELLE": "Sandale Cuir Bride Femme",
                    "FAMILLE": "FEM",
                    "NOMBRE": 10,
                    "PRIX_ACHAT": Decimal("1800.00"),
                    "BTARIF1": Decimal("3500.00"),
                    "BTARIF2": Decimal("3000.00"),
                    "BTARIF3": Decimal("2500.00"),
                    "ST_BL": 50,
                    "POINTURE": "36/41",
                    "CASIER": "B14",
                },
                {
                    "ARTICLE": "A005",
                    "REFERENCE": "SNE-MAX-90",
                    "LIBELLE": "Sneaker Sport Cushioned",
                    "FAMILLE": "SPORT",
                    "NOMBRE": 12,
                    "PRIX_ACHAT": Decimal("3200.00"),
                    "BTARIF1": Decimal("5600.00"),
                    "BTARIF2": Decimal("4900.00"),
                    "BTARIF3": Decimal("4200.00"),
                    "ST_BL": 60,
                    "POINTURE": "39/44",
                    "CASIER": "C22",
                },
                {
                    "ARTICLE": "A006",
                    "REFERENCE": "BAS-RUN-40",
                    "LIBELLE": "Basket Basse Ville Toile",
                    "FAMILLE": "SPORT",
                    "NOMBRE": 12,
                    "PRIX_ACHAT": Decimal("1600.00"),
                    "BTARIF1": Decimal("2900.00"),
                    "BTARIF2": Decimal("2500.00"),
                    "BTARIF3": Decimal("2100.00"),
                    "ST_BL": 72,
                    "POINTURE": "38/43",
                    "CASIER": "D08",
                },
                {
                    "ARTICLE": "A007",
                    "REFERENCE": "CHA-ENF-01",
                    "LIBELLE": "Chaussure Enfant Scratch Sport",
                    "FAMILLE": "ENF",
                    "NOMBRE": 12,
                    "PRIX_ACHAT": Decimal("1400.00"),
                    "BTARIF1": Decimal("2600.00"),
                    "BTARIF2": Decimal("2200.00"),
                    "BTARIF3": Decimal("1900.00"),
                    "ST_BL": 36,
                    "POINTURE": "30/35",
                    "CASIER": "E03",
                },
                {
                    "ARTICLE": "A008",
                    "REFERENCE": "ESZ-SOI-04",
                    "LIBELLE": "Escarpin Soirée Cuir Talon",
                    "FAMILLE": "FEM",
                    "NOMBRE": 8,
                    "PRIX_ACHAT": Decimal("2900.00"),
                    "BTARIF1": Decimal("5200.00"),
                    "BTARIF2": Decimal("4500.00"),
                    "BTARIF3": Decimal("3900.00"),
                    "ST_BL": 24,
                    "POINTURE": "36/40",
                    "CASIER": "A18",
                },
            ],
        },
        "CHEQUEXP.DBF": {
            "fields": [
                {"name": "NUM", "type": "C", "length": 10},
                {"name": "CLIENT", "type": "C", "length": 10},
                {"name": "DESIGNAT", "type": "C", "length": 40},
                {"name": "CHEQUE", "type": "C", "length": 20},
                {"name": "COMPTE", "type": "C", "length": 20},
                {"name": "MONTANT", "type": "N", "length": 12, "decimal": 2},
                {"name": "REGLE", "type": "C", "length": 1},
                {"name": "DATE_FACT", "type": "D", "length": 8},
                {"name": "DATE_BNA", "type": "D", "length": 8},
            ],
            "records": [
                {
                    "NUM": "101",
                    "CLIENT": "CLT001",
                    "DESIGNAT": "Boutique El Amine Gros",
                    "CHEQUE": "CHQ-887711",
                    "COMPTE": "BNA",
                    "MONTANT": Decimal("75000.00"),
                    "REGLE": "N",
                    "DATE_FACT": today - datetime.timedelta(days=20),
                    "DATE_BNA": today + datetime.timedelta(days=10),
                },
                {
                    "NUM": "102",
                    "CLIENT": "CLT002",
                    "DESIGNAT": "Chaussures Didouche Demi-Gros",
                    "CHEQUE": "CHQ-887712",
                    "COMPTE": "CPA",
                    "MONTANT": Decimal("35000.00"),
                    "REGLE": "N",
                    "DATE_FACT": today - datetime.timedelta(days=15),
                    "DATE_BNA": today + datetime.timedelta(days=15),
                },
                {
                    "NUM": "103",
                    "CLIENT": "CLT004",
                    "DESIGNAT": "Ets Benali & Frères Gros",
                    "CHEQUE": "CHQ-887713",
                    "COMPTE": "BEA",
                    "MONTANT": Decimal("120000.00"),
                    "REGLE": "O",
                    "DATE_FACT": today - datetime.timedelta(days=45),
                    "DATE_BNA": today - datetime.timedelta(days=5),
                },
            ],
        },
        "CREANCE.DBF": {
            "fields": [
                {"name": "NUM", "type": "C", "length": 10},
                {"name": "CLIENT", "type": "C", "length": 10},
                {"name": "DESIGNAT", "type": "C", "length": 40},
                {"name": "CHEQUE", "type": "C", "length": 20},
                {"name": "COMPTE", "type": "C", "length": 20},
                {"name": "MONTANT", "type": "N", "length": 12, "decimal": 2},
                {"name": "REGLE", "type": "C", "length": 1},
                {"name": "DATE_FACT", "type": "D", "length": 8},
            ],
            "records": [
                {
                    "NUM": "201",
                    "CLIENT": "CLT001",
                    "DESIGNAT": "Boutique El Amine Gros",
                    "CHEQUE": "EFFET-2026-01",
                    "COMPTE": "BDL",
                    "MONTANT": Decimal("50000.00"),
                    "REGLE": "",
                    "DATE_FACT": today - datetime.timedelta(days=10),
                },
                {
                    "NUM": "202",
                    "CLIENT": "CLT004",
                    "DESIGNAT": "Ets Benali & Frères Gros",
                    "CHEQUE": "EFFET-2026-02",
                    "COMPTE": "BNA",
                    "MONTANT": Decimal("80000.00"),
                    "REGLE": "",
                    "DATE_FACT": today - datetime.timedelta(days=8),
                },
            ],
        },
        "GCPARAM.DBF": {
            "fields": [
                {"name": "SOCIETE", "type": "C", "length": 40},
                {"name": "TELFAX", "type": "C", "length": 20},
                {"name": "IFISC", "type": "C", "length": 20},
            ],
            "records": [
                {
                    "SOCIETE": "ShoeDZ Distribution Demo SARL",
                    "TELFAX": "023 50 11 22",
                    "IFISC": "123456789012345",
                }
            ],
        },
    }


# ─────────────────────────────────────────────────────────────────────────────
# 3. Excel & CSV Fixture Builders
# ─────────────────────────────────────────────────────────────────────────────

def _style_excel_sheet(ws, title: str):
    """Applies a professional header style to demo spreadsheets."""
    if not openpyxl:
        return
    header_fill = PatternFill(start_color="1E3A8A", end_color="1E3A8A", fill_type="solid")
    header_font = Font(name="Segoe UI", size=11, bold=True, color="FFFFFF")
    data_font = Font(name="Segoe UI", size=10)
    thin_border = Border(
        left=Side(style="thin", color="CBD5E1"),
        right=Side(style="thin", color="CBD5E1"),
        top=Side(style="thin", color="CBD5E1"),
        bottom=Side(style="thin", color="CBD5E1"),
    )

    for cell in ws[1]:
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)

    for row in ws.iter_rows(min_row=2):
        for cell in row:
            cell.font = data_font
            cell.border = thin_border
            if isinstance(cell.value, (int, float, Decimal)):
                cell.alignment = Alignment(horizontal="right")

    for col in ws.columns:
        max_len = max(len(str(cell.value or "")) for cell in col)
        col_letter = openpyxl.utils.get_column_letter(col[0].column)
        ws.column_dimensions[col_letter].width = max(max_len + 4, 12)


def generate_purchase_order_fixtures(target_dir: Path) -> None:
    """Generates French, Arabic, English matrix, and CSV purchase order files."""
    target_dir.mkdir(parents=True, exist_ok=True)

    # 1. French Excel
    if openpyxl:
        wb_fr = openpyxl.Workbook()
        ws_fr = wb_fr.active
        ws_fr.title = "Bon de Commande"
        fr_headers = ["Référence", "Désignation", "Pointure", "Couleur", "Quantité", "Prix Achat"]
        ws_fr.append(fr_headers)
        fr_rows = [
            ["BSK-AIR-10", "Basket Air Pro Running", "40", "Noir", 24, 2800.00],
            ["BSK-AIR-10", "Basket Air Pro Running", "41", "Noir", 36, 2800.00],
            ["BSK-AIR-10", "Basket Air Pro Running", "42", "Noir", 48, 2800.00],
            ["BOT-CUI-22", "Bottine Cuir Hiver Homme", "41", "Marron", 20, 3500.00],
            ["BOT-CUI-22", "Bottine Cuir Hiver Homme", "42", "Marron", 30, 3500.00],
            ["BOT-CUI-22", "Bottine Cuir Hiver Homme", "43", "Marron", 20, 3500.00],
            ["SAN-ETE-12", "Sandale Cuir Bride Femme", "37", "Beige", 30, 1800.00],
            ["SAN-ETE-12", "Sandale Cuir Bride Femme", "38", "Beige", 40, 1800.00],
            ["SAN-ETE-12", "Sandale Cuir Bride Femme", "39", "Beige", 30, 1800.00],
        ]
        for r in fr_rows:
            ws_fr.append(r)
        _style_excel_sheet(ws_fr, "Bon de Commande")
        wb_fr.save(target_dir / "bon_commande_fournisseur_french.xlsx")

        # 2. Arabic Excel
        wb_ar = openpyxl.Workbook()
        ws_ar = wb_ar.active
        ws_ar.title = "طلب توريد"
        ws_ar.views.sheetView[0].rightToLeft = True
        ar_headers = ["المرجع", "التعيين", "المقاس", "اللون", "الكمية", "سعر الشراء"]
        ws_ar.append(ar_headers)
        ar_rows = [
            ["BSK-AIR-10", "حذاء رياضي إير برو", "41", "أسود", 36, "2 800,00 دج"],
            ["BSK-AIR-10", "حذاء رياضي إير برو", "42", "أسود", 48, "2 800,00 دج"],
            ["BOT-CUI-22", "حذاء شتوي جلد طبيعي", "42", "بني", 30, "3 500,00 دج"],
            ["BOT-CUI-22", "حذاء شتوي جلد طبيعي", "43", "بني", 20, "3 500,00 دج"],
            ["SAN-ETE-12", "صندل صيفي جلد نسائي", "38", "بيج", 40, "1 800,00 دج"],
        ]
        for r in ar_rows:
            ws_ar.append(r)
        _style_excel_sheet(ws_ar, "طلب توريد")
        wb_ar.save(target_dir / "bon_commande_fournisseur_arabic.xlsx")

        # 3. English Pivot Matrix Excel
        wb_en = openpyxl.Workbook()
        ws_en = wb_en.active
        ws_en.title = "Order Matrix"
        matrix_headers = ["Ref", "Description", "Color", "39", "40", "41", "42", "43", "44", "Unit Cost"]
        ws_en.append(matrix_headers)
        matrix_rows = [
            ["BSK-AIR-10", "Air Pro Running Sneaker", "Black", 6, 12, 24, 24, 12, 6, 2800.00],
            ["BOT-CUI-22", "Winter Leather Boots Men", "Brown", 0, 10, 20, 30, 20, 10, 3500.00],
            ["MOC-CLA-05", "Comfort Loafers Leather", "Navy", 8, 12, 16, 16, 12, 8, 2200.00],
            ["SNE-MAX-90", "Max Cushion Running Sneaker", "White", 6, 12, 18, 18, 12, 6, 3200.00],
        ]
        for r in matrix_rows:
            ws_en.append(r)
        _style_excel_sheet(ws_en, "Order Matrix")
        wb_en.save(target_dir / "supplier_order_matrix_english.xlsx")

    # 4. Standard CSV (Semicolon delimited)
    csv_path = target_dir / "bon_commande_simple.csv"
    with open(csv_path, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.writer(f, delimiter=";")
        writer.writerow(["Référence", "Désignation", "Pointure", "Couleur", "Quantité", "Prix Achat"])
        writer.writerow(["BSK-AIR-10", "Basket Air Pro Running", "40", "Noir", "24", "2800,00"])
        writer.writerow(["BSK-AIR-10", "Basket Air Pro Running", "41", "Noir", "36", "2800,00"])
        writer.writerow(["BSK-AIR-10", "Basket Air Pro Running", "42", "Noir", "48", "2800,00"])
        writer.writerow(["BOT-CUI-22", "Bottine Cuir Hiver Homme", "41", "Marron", "20", "3500,00"])
        writer.writerow(["BOT-CUI-22", "Bottine Cuir Hiver Homme", "42", "Marron", "30", "3500,00"])
        writer.writerow(["SAN-ETE-12", "Sandale Cuir Bride Femme", "38", "Beige", "40", "1800,00"])


def generate_product_catalog_fixtures(target_dir: Path) -> None:
    """Generates product catalog Excel and CSV import files."""
    target_dir.mkdir(parents=True, exist_ok=True)

    catalog_headers = [
        "name", "brand", "category", "gender", "purchase_price", "sale_price",
        "size_eu", "colour", "barcode", "reference", "initial_stock", "alert_threshold"
    ]

    catalog_rows = [
        ["Air Max Pulse", "Nike", "sneakers", "M", 4500, 8500, 40, "Noir", "2130010001001", "NK-AM-PUL-40", 15, 3],
        ["Air Max Pulse", "Nike", "sneakers", "M", 4500, 8500, 41, "Noir", "2130010001002", "NK-AM-PUL-41", 20, 3],
        ["Air Max Pulse", "Nike", "sneakers", "M", 4500, 8500, 42, "Noir", "2130010001003", "NK-AM-PUL-42", 25, 3],
        ["Air Max Pulse", "Nike", "sneakers", "M", 4500, 8500, 43, "Noir", "2130010001004", "NK-AM-PUL-43", 20, 3],
        ["Ultra Boost Light", "Adidas", "sport", "U", 5200, 9500, 40, "Blanc", "2130010002001", "AD-UB-LGT-40", 12, 3],
        ["Ultra Boost Light", "Adidas", "sport", "U", 5200, 9500, 41, "Blanc", "2130010002002", "AD-UB-LGT-41", 18, 3],
        ["Ultra Boost Light", "Adidas", "sport", "U", 5200, 9500, 42, "Blanc", "2130010002003", "AD-UB-LGT-42", 22, 3],
        ["Bottine Ville Cuir", "Geox", "formal", "M", 3800, 6900, 41, "Marron", "2130010003001", "GX-BOT-VIL-41", 10, 2],
        ["Bottine Ville Cuir", "Geox", "formal", "M", 3800, 6900, 42, "Marron", "2130010003002", "GX-BOT-VIL-42", 15, 2],
        ["Sandale Tressée Confort", "Clarks", "sandals", "F", 2200, 4200, 37, "Beige", "2130010004001", "CK-SAN-TRS-37", 14, 2],
        ["Sandale Tressée Confort", "Clarks", "sandals", "F", 2200, 4200, 38, "Beige", "2130010004002", "CK-SAN-TRS-38", 18, 2],
        ["Sandale Tressée Confort", "Clarks", "sandals", "F", 2200, 4200, 39, "Beige", "2130010004003", "CK-SAN-TRS-39", 12, 2],
    ]

    # Excel format
    if openpyxl:
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "Catalogue Import"
        ws.append(catalog_headers)
        for r in catalog_rows:
            ws.append(r)
        _style_excel_sheet(ws, "Catalogue Import")
        wb.save(target_dir / "catalogue_produits_import.xlsx")

    # CSV format
    with open(target_dir / "catalogue_produits_import.csv", "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.writer(f)
        writer.writerow(catalog_headers)
        for r in catalog_rows:
            writer.writerow(r)


def generate_readme(target_dir: Path) -> None:
    """Creates a complete usage guide for the generated fixtures."""
    readme_path = target_dir / "README.md"
    content = """# ShoeDZ Demo Import Fixtures

This directory contains synthetic, fully anonymized sample datasets designed for demonstration, user guide walkthroughs, automated tests, and import wizards in ShoeDZ (Pointure).

> **Privacy & Compliance Notice:**
> All records in this directory are 100% synthetic fixtures generated programmatically. No real customer, supplier, or financial data from legacy archives is stored or committed.

---

## 1. Directory Structure

```
fixtures/demo_imports/
├── legacy_dbf/                # Algerian footwear store dBase III migration files
│   ├── CLIENT.DBF             # Clients with price tiers (1=détail, 2=demi-gros, 3=gros), debts, NIF, RC
│   ├── FOURNISS.DBF           # Suppliers with outstanding balances and phone numbers
│   ├── ARTICLE.DBF            # Articles with 3 price tiers (BTARIF1, BTARIF2, BTARIF3), sizes (POINTURE), shelves (CASIER)
│   ├── FAMILLE.DBF            # Categories (Homme, Femme, Sport, Enfant, Ville)
│   ├── CHEQUEXP.DBF           # Client cheques received and pending deposit (BNA, CPA, BEA)
│   ├── CREANCE.DBF            # Opening debit ledger entries / promissory notes
│   └── GCPARAM.DBF            # Legacy store configuration (NIF, phone, company name)
│
├── purchase_orders/           # Supplier Purchase Order import templates
│   ├── bon_commande_fournisseur_french.xlsx   # Standard French footwear purchase order
│   ├── bon_commande_fournisseur_arabic.xlsx   # Arabic purchase order (CP1256 / UTF-8, RTL)
│   ├── supplier_order_matrix_english.xlsx     # English size-breakdown matrix (sizes 39..44 columns)
│   └── bon_commande_simple.csv                # Semicolon-delimited CSV format
│
└── products/                  # Mass product catalog onboarding
    ├── catalogue_produits_import.xlsx         # Multi-variant Excel catalog
    └── catalogue_produits_import.csv          # Standard CSV catalog import
```

---

## 2. How to Use These Fixtures in the Application

### A. Legacy dBase Migration (Assistant de Migration)
1. In the sidebar, navigate to **Paramètres** → **Migration / Importation Legacy**.
2. Select or upload the folder `fixtures/demo_imports/legacy_dbf/` (or package it into a `.zip` archive).
3. Choose your migration options:
   - **Mode Simple (1-clic)** or **Mode Complet (Tailles & Variantes)**.
   - Initial stock allocation strategy.
4. Click **Tester (Simulation / Dry-Run)** to inspect warnings and balance verification.
5. Click **Lancer l'importation** to populate the store with realistic Algerian footwear data.

### B. Smart Purchase Order Importer (Import Bon de Commande Fournisseur)
1. Go to **Fournisseurs** → **Bons de commande** → **Importer (Excel / CSV)**.
2. Select any supplier (e.g. *Sarl El Eulma Import*).
3. Drag & drop any of the files in `fixtures/demo_imports/purchase_orders/`:
   - `bon_commande_fournisseur_french.xlsx`
   - `bon_commande_fournisseur_arabic.xlsx`
   - `supplier_order_matrix_english.xlsx`
4. The import engine automatically detects the header language, encodings, and column formats.
5. Review the preview and click **Créer le bon de commande**.

### C. Mass Product Import Wizard (Import Catalogue Produits)
1. Go to **Stock & Articles** → **Importer des produits**.
2. Upload `fixtures/demo_imports/products/catalogue_produits_import.xlsx`.
3. Preview variants, barcodes, and initial stock units, then confirm the import.

---

## 3. Regenerating Fixtures via CLI

You can regenerate or reset these fixtures at any time using Django management commands:

```bash
cd backend
# Regenerates all fixtures and updates demo database:
venv/bin/python manage.py seed_demo --reset
```
"""
    readme_path.write_text(content.strip() + "\n", encoding="utf-8")


# ─────────────────────────────────────────────────────────────────────────────
# 4. Master Generator Function
# ─────────────────────────────────────────────────────────────────────────────

def generate_demo_fixtures(output_root: Optional[Path] = None) -> Path:
    """
    Generates all demo fixtures into fixtures/demo_imports/ under the repo root.
    Returns the resolved output directory path.
    """
    if output_root is None:
        # Navigate from backend/apps/core/services/demo_fixtures_generator.py to repo root
        current_file = Path(__file__).resolve()
        repo_root = current_file.parents[4]  # repo root
        output_root = repo_root / "fixtures" / "demo_imports"

    output_root.mkdir(parents=True, exist_ok=True)

    # 1. Legacy DBF files
    legacy_dir = output_root / "legacy_dbf"
    legacy_dataset = get_legacy_dbf_synthetic_dataset()
    for filename, data in legacy_dataset.items():
        dbf_path = str(legacy_dir / filename)
        write_dbf(dbf_path, data["fields"], data["records"])
        # Also write ARTICLEB.DBF as an alias for ARTICLE.DBF (used by some retail systems)
        if filename == "ARTICLE.DBF":
            write_dbf(str(legacy_dir / "ARTICLEB.DBF"), data["fields"], data["records"])

    # 2. Purchase Order import files
    po_dir = output_root / "purchase_orders"
    generate_purchase_order_fixtures(po_dir)

    # 3. Product catalog import files
    prod_dir = output_root / "products"
    generate_product_catalog_fixtures(prod_dir)

    # 4. README documentation
    generate_readme(output_root)

    return output_root

