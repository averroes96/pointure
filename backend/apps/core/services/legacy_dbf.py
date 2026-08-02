import os
import datetime
from decimal import Decimal
from django.db import transaction
from dbfread import DBF

from apps.core.models import Tenant, Branch
from apps.suppliers.models import Supplier
from apps.clients.models import Client, ClientLedger
from apps.inventory.models import (
    Product, Variant, StockMovement, MovementReasonChoices, CategoryChoices, GenderChoices
)
from apps.sales.models import Sale, SaleItem, SaleStatusChoices, PaymentMethodChoices, Payment

def safe_decimal(val):
    if val is None: return Decimal("0.00")
    if isinstance(val, (int, float)): return Decimal(str(val))
    if isinstance(val, str):
        try: return Decimal(val.strip())
        except: pass
    return Decimal("0.00")

def safe_str(val):
    if val is None: return ""
    if isinstance(val, str): return val.strip()
    return str(val).strip()

def safe_int(val):
    if val is None: return 0
    if isinstance(val, (int, float)): return int(val)
    if isinstance(val, str):
        try: return int(val.strip())
        except: pass
    return 0

def get_family_details(cat_name: str):
    """
    Infers gender, category, and standard size range based on the legacy FAMILLE name.
    """
    cat_lower = cat_name.lower()
    
    # 1. Gender & Sizes
    if any(k in cat_lower for k in ["fillette", "garcon", "garçon", "enfant", "bebe", "bébé"]):
        gender = GenderChoices.KIDS
        sizes = [30, 31, 32, 33, 34, 35]
    elif any(k in cat_lower for k in ["femme", "fille", "soiree", "soirée", "ballerine", "sabot femme", "sandal-femme"]):
        gender = GenderChoices.WOMEN
        sizes = [36, 37, 38, 39, 40, 41]
    elif any(k in cat_lower for k in ["homme", "classique"]):
        gender = GenderChoices.MEN
        sizes = [40, 41, 42, 43, 44, 45]
    else:
        gender = GenderChoices.UNISEX
        sizes = [37, 38, 39, 40, 41, 42]

    # 2. Category
    if any(k in cat_lower for k in ["basket", "sneaker", "skitchers"]):
        category = CategoryChoices.SNEAKERS
    elif any(k in cat_lower for k in ["sandal"]):
        category = CategoryChoices.SANDALS
    elif any(k in cat_lower for k in ["botte", "bot"]):
        category = CategoryChoices.BOOTS
    elif any(k in cat_lower for k in ["pantoufle", "sabot", "babouche", "plastique"]):
        category = CategoryChoices.SLIPPERS
    elif any(k in cat_lower for k in ["fillette", "garcon", "garçon"]) and not any(k in cat_lower for k in ["basket", "sandal"]):
        category = CategoryChoices.KIDS_SHOES
    elif any(k in cat_lower for k in ["classique", "moccasin", "soiree", "soirée", "ballerine", "chaussure"]):
        category = CategoryChoices.FORMAL
    else:
        category = CategoryChoices.OTHER

    return gender, category, sizes

def distribute_quantity(total_qty: int, sizes: list[int]) -> dict[int, int]:
    """
    Distributes total stock quantity across the given list of sizes.
    Evenly allocates the base amount and assigns remainder pairs to the most popular middle sizes.
    """
    if total_qty <= 0 or not sizes:
        return {s: 0 for s in sizes}

    n = len(sizes)
    base = total_qty // n
    rem = total_qty % n

    distribution = {s: base for s in sizes}
    if rem > 0:
        center = (n - 1) / 2.0
        priority_indices = sorted(range(n), key=lambda i: abs(i - center))
        for i in range(rem):
            size = sizes[priority_indices[i]]
            distribution[size] += 1

    return distribution

class LegacyDBFImporter:
    def __init__(self, path, tenant, branch, logger=None, options=None):
        self.path = path
        self.tenant = tenant
        self.branch = branch
        self.logger = logger
        self.options = options or {}
        self.product_map = {}
        self.stats = {
            "suppliers_imported": 0,
            "clients_imported": 0,
            "products_imported": 0,
            "stock_units_imported": 0,
            "sales_imported": 0,
            "refunds_imported": 0,
            "warnings": []
        }

    def log(self, message):
        if self.logger:
            self.logger(message)

    def get_dbf(self, filename):
        file_path = os.path.join(self.path, filename)
        if not os.path.exists(file_path):
            file_path = os.path.join(self.path, filename.lower())
        if not os.path.exists(file_path):
            self.stats["warnings"].append(f"File {filename} not found.")
            return []
        try:
            return DBF(file_path, ignore_missing_memofile=True, raw=False, encoding="cp850", char_decode_errors="replace")
        except Exception as e:
            self.stats["warnings"].append(f"Error reading {filename}: {str(e)}")
            return []

    def execute_import(self):
        with transaction.atomic():
            if self.options.get("suppliers", True):
                self._import_suppliers()
            if self.options.get("clients", True):
                self._import_clients()
            if self.options.get("products", True):
                self._import_products()
            if self.options.get("defects", True):
                self._import_defects()
            if self.options.get("sales", True):
                self._import_sales()
        return self.stats

    def _import_suppliers(self):
        self.log("Importing Suppliers...")
        records = self.get_dbf("FOURNISS.DBF")
        for r in records:
            name = safe_str(r.get("RAISON"))
            if not name: continue
            Supplier.objects.update_or_create(
                tenant=self.tenant,
                name=name,
                defaults={
                    "phone": safe_str(r.get("TELEPHONE")),
                    "address": safe_str(r.get("ADRESSE")),
                    "outstanding_balance": safe_decimal(r.get("MT_RESTE"))
                }
            )
            self.stats["suppliers_imported"] += 1

    def _import_clients(self):
        self.log("Importing Clients...")
        records = self.get_dbf("CLIENT.DBF")
        for r in records:
            name = safe_str(r.get("DESIGNAT"))
            if not name: continue
            
            phone = safe_str(r.get("TEL1"))
            client, created = Client.objects.get_or_create(
                tenant=self.tenant,
                name=name,
                defaults={
                    "phone": phone[:20],
                    "address": safe_str(r.get("ADRESSE"))
                }
            )
            if not created:
                client.phone = phone[:20]
                client.address = safe_str(r.get("ADRESSE"))
                client.save(update_fields=['phone', 'address'])

            debt = safe_decimal(r.get("MT_RESTE"))
            if debt > 0 and created:
                ClientLedger.objects.create(
                    tenant=self.tenant,
                    client=client,
                    entry_type="debit",
                    amount=debt,
                    date=datetime.date.today(),
                    description="Opening Balance (Imported from Legacy)",
                    reference_number="LEGACY-OPENING"
                )
            elif debt < 0 and created:
                ClientLedger.objects.create(
                    tenant=self.tenant,
                    client=client,
                    entry_type="credit",
                    amount=abs(debt),
                    date=datetime.date.today(),
                    description="Opening Credit (Imported from Legacy)",
                    reference_number="LEGACY-OPENING"
                )
            self.stats["clients_imported"] += 1

    def _import_products(self):
        self.log("Importing Families & Products...")
        fam_records = self.get_dbf("FAMILLE.DBF")
        family_map = {}
        for r in fam_records:
            family_map[safe_str(r.get("FAMILLE"))] = safe_str(r.get("LIBELLE"))

        records = self.get_dbf("ARTICLEB.DBF")
        
        for r in records:
            ref = safe_str(r.get("REFERENCE"))
            name = safe_str(r.get("LIBELLE"))
            if not name: name = ref
            if not name: continue
            
            fam = safe_str(r.get("FAMILLE"))
            cat_name = family_map.get(fam, "")
            gender, category, sizes = get_family_details(cat_name)
            
            pairs_per_carton = safe_int(r.get("NOMBRE")) or 10
            wholesale_price = safe_decimal(r.get("BTARIF2"))
            if wholesale_price <= 0:
                wholesale_price = safe_decimal(r.get("BTARIF1"))
            
            prod, _ = Product.objects.update_or_create(
                tenant=self.tenant,
                reference=ref,
                defaults={
                    "name": name[:200],
                    "category": category,
                    "gender": gender,
                    "purchase_price": safe_decimal(r.get("PRIX_ACHAT")),
                    "sale_price": safe_decimal(r.get("BTARIF1")),
                    "wholesale_price": wholesale_price,
                    "pairs_per_carton": pairs_per_carton,
                }
            )
            
            st_bl = safe_int(r.get("ST_BL"))
            stock_distribution = distribute_quantity(st_bl, sizes)
            
            middle_variant = None
            middle_size = sizes[len(sizes) // 2]
            
            for sz in sizes:
                var, _ = Variant.objects.get_or_create(
                    tenant=self.tenant,
                    product=prod,
                    size_eu=sz,
                    colour="Standard"
                )
                if sz == middle_size:
                    middle_variant = var
                
                qty = stock_distribution.get(sz, 0)
                if qty > 0:
                    StockMovement.objects.create(
                        tenant=self.tenant,
                        branch=self.branch,
                        variant=var,
                        quantity_delta=qty,
                        reason=MovementReasonChoices.INITIAL,
                        notes=f"Imported from Legacy ST_BL (Size {sz})"
                    )
                    self.stats["stock_units_imported"] += qty
            
            legacy_id = safe_str(r.get("ARTICLE"))
            self.product_map[legacy_id] = middle_variant or var
            self.stats["products_imported"] += 1

    def _import_defects(self):
        self.log("Importing Defective Items from Legacy Purchases...")
        records = self.get_dbf("ACHATART.DBF") or self.get_dbf("ACHATMVT.DBF")
        if not records:
            return
        from apps.inventory.models import DefectItem, DefectStatusChoices
        for r in records:
            qte_defaut = safe_int(r.get("QTE_DEFAUT"))
            if qte_defaut <= 0:
                continue
            legacy_id = safe_str(r.get("ARTICLE"))
            var = self.product_map.get(legacy_id)
            if not var:
                continue
            pu_defaut = safe_decimal(r.get("PU_DEFAUT"))
            if pu_defaut <= 0:
                pu_defaut = var.product.purchase_price
            reg_defaut = safe_str(r.get("REG_DEFAUT")).upper()
            status = DefectStatusChoices.RETURNED if reg_defaut in ["O", "1", "TRUE", "VRAI", "YES"] else DefectStatusChoices.QUARANTINED
            DefectItem.objects.create(
                tenant=self.tenant,
                branch=self.branch,
                variant=var,
                quantity=qte_defaut,
                cost_price=pu_defaut,
                status=status,
                defect_reason="other",
                notes=f"Importé depuis les réceptions historiques (Règlement: {reg_defaut or 'Non'})",
            )
            self.stats["defects_imported"] = self.stats.get("defects_imported", 0) + qte_defaut

    def _import_sales(self):
        self.log("Importing Historical Sales...")
        sales_files = [f"VENTED{str(i).zfill(2)}.DBF" for i in range(1, 13)]
        
        for file in sales_files:
            records = self.get_dbf(file)
            if not records: continue
            
            sales_group = {}
            for r in records:
                num = safe_str(r.get("NUMERO"))
                date_fact = r.get("DATE_FACT")
                if not date_fact: date_fact = datetime.date.today()
                
                key = f"{num}_{date_fact}"
                if key not in sales_group:
                    sales_group[key] = {"date": date_fact, "num": num, "items": []}
                sales_group[key]["items"].append(r)
                
            for key, data in sales_group.items():
                items = data["items"]
                is_refund = all(safe_int(x.get("QUANTITE")) < 0 for x in items)
                status = SaleStatusChoices.REFUNDED if is_refund else SaleStatusChoices.COMPLETED
                
                total_amount = Decimal("0.00")
                sale_items_data = []
                
                for x in items:
                    qte = safe_int(x.get("QUANTITE"))
                    pv = safe_decimal(x.get("PRIX_VENTE"))
                    legacy_id = safe_str(x.get("ARTICLE"))
                    
                    if qte == 0: continue
                    if legacy_id not in self.product_map: continue
                    
                    var = self.product_map[legacy_id]
                    qty = abs(qte)
                    subtotal = qty * pv
                    total_amount += subtotal
                    
                    sale_items_data.append({
                        "variant": var,
                        "quantity": qty,
                        "unit_price": pv,
                        "subtotal": subtotal
                    })
                    
                if not sale_items_data: continue
                
                sale = Sale.objects.create(
                    tenant=self.tenant,
                    branch=self.branch,
                    status=status,
                    total_amount=total_amount,
                    discount_amount=Decimal("0.00"),
                    receipt_number=data["num"][:30]
                )
                
                if status == SaleStatusChoices.COMPLETED:
                    Payment.objects.create(
                        sale=sale,
                        amount=total_amount,
                        method=PaymentMethodChoices.CASH
                    )
                
                if isinstance(data["date"], datetime.date):
                    sale.created_at = datetime.datetime.combine(data["date"], datetime.time(12, 0))
                    sale.save(update_fields=['created_at'])
                
                for sid in sale_items_data:
                    SaleItem.objects.create(
                        sale=sale,
                        variant=sid["variant"],
                        quantity=sid["quantity"],
                        unit_price=sid["unit_price"]
                    )
                    
                if is_refund:
                    self.stats["refunds_imported"] += 1
                else:
                    self.stats["sales_imported"] += 1
