import os
import datetime
from decimal import Decimal
from django.db import transaction
from dbfread import DBF

from apps.core.models import Tenant, Branch
from apps.suppliers.models import Supplier
from apps.clients.models import Client, ClientLedger
from apps.inventory.models import Product, Variant, StockMovement, MovementReasonChoices, CategoryChoices
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
            family_map[safe_str(r.get("FAMILLE"))] = safe_str(r.get("LIBELLE")).lower()

        records = self.get_dbf("ARTICLEB.DBF")
        
        for r in records:
            ref = safe_str(r.get("REFERENCE"))
            name = safe_str(r.get("LIBELLE"))
            if not name: name = ref
            if not name: continue
            
            fam = safe_str(r.get("FAMILLE"))
            cat_name = family_map.get(fam, "")
            category = CategoryChoices.OTHER
            if "chaussure" in cat_name or "sneaker" in cat_name: category = CategoryChoices.SNEAKERS
            elif "sandal" in cat_name: category = CategoryChoices.SANDALS
            elif "bot" in cat_name: category = CategoryChoices.BOOTS
            
            prod, _ = Product.objects.update_or_create(
                tenant=self.tenant,
                reference=ref,
                defaults={
                    "name": name[:200],
                    "category": category,
                    "purchase_price": safe_decimal(r.get("PRIX_ACHAT")),
                    "sale_price": safe_decimal(r.get("BTARIF1")),
                }
            )
            
            var, _ = Variant.objects.get_or_create(
                tenant=self.tenant,
                product=prod,
                size_eu=38,
                colour="Standard"
            )
            
            legacy_id = safe_str(r.get("ARTICLE"))
            self.product_map[legacy_id] = var
            
            st_bl = safe_int(r.get("ST_BL"))
            if st_bl > 0:
                StockMovement.objects.create(
                    tenant=self.tenant,
                    branch=self.branch,
                    variant=var,
                    quantity_delta=st_bl,
                    reason=MovementReasonChoices.INITIAL,
                    notes="Imported from Legacy ST_BL"
                )
                self.stats["stock_units_imported"] += st_bl
            self.stats["products_imported"] += 1

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
