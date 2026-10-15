import os
import re
import datetime
from decimal import Decimal
from django.db import transaction
from dbfread import DBF

from apps.core.models import Tenant, Branch, StoreSettings
from apps.suppliers.models import Supplier, PurchaseOrder, POLine, POStatusChoices
from apps.clients.models import Client, ClientLedger
from apps.inventory.models import (
    Product, Variant, StockMovement, MovementReasonChoices, CategoryChoices, GenderChoices,
    DefectItem, DefectStatusChoices
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

def parse_pointure_range(val: str, default_sizes: list[int]) -> list[int]:
    """
    Parses a size range like '36/41', '36-41' into a list of integers.
    """
    val = safe_str(val)
    if not val: return default_sizes
    
    match = re.search(r'(\d{2})[/\-\s]+(\d{2})', val)
    if match:
        start = int(match.group(1))
        end = int(match.group(2))
        if start <= end and end - start <= 20: # Sanity check for reasonable range
            return list(range(start, end + 1))
    return default_sizes

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
        self.software_type = self.options.get("software_type", "retail")
        
        # Easy Mode is True by default for Algerian shoe retail shops
        # (1 product = 1 default variant with size_eu=0, exact physical ST_BL stock, no artificial size splits).
        if "easy_mode" in self.options:
            self.easy_mode = bool(self.options["easy_mode"])
        elif "expand_sizes" in self.options:
            self.easy_mode = not bool(self.options["expand_sizes"])
        else:
            self.easy_mode = True

        self.product_map = {}
        self.supplier_map = {}
        self.client_map = {}
        self.stats = {
            "suppliers_imported": 0,
            "clients_imported": 0,
            "products_imported": 0,
            "stock_units_imported": 0,
            "purchase_orders_imported": 0,
            "sales_imported": 0,
            "refunds_imported": 0,
            "defects_imported": 0,
            "store_settings_updated": False,
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
            self._import_store_settings()
            if self.options.get("suppliers", True):
                self._import_suppliers()
            if self.options.get("clients", True):
                self._import_clients()
            if self.options.get("products", True):
                self._import_products()
            if self.options.get("purchases", True):
                self._import_purchases()
            if self.options.get("defects", True):
                self._import_defects()
            if self.options.get("sales", True):
                self._import_sales()
        return self.stats

    def _import_store_settings(self):
        """
        Configure StoreSettings (Easy Mode / enable_variants) and import business identity from GCPARAM.DBF.
        """
        self.log("Configuring Store Settings...")
        try:
            settings_obj, _ = StoreSettings.objects.get_or_create(tenant=self.tenant)
            settings_obj.enable_variants = not self.easy_mode
            settings_obj.save(update_fields=["enable_variants"])
            self.stats["store_settings_updated"] = True
        except Exception as e:
            self.stats["warnings"].append(f"Could not update StoreSettings: {e}")

        # Check GCPARAM.DBF for company name, phone, NIF, and receipt footer
        gc_records = self.get_dbf("GCPARAM.DBF")
        for r in gc_records:
            societe = safe_str(r.get("SOCIETE"))
            if societe and (self.tenant.name == "Primary Branch" or "DEMO" in self.tenant.name.upper() or not self.tenant.name):
                self.tenant.name = societe[:200]
            phone = safe_str(r.get("TELFAX"))
            if phone and not self.tenant.phone:
                self.tenant.phone = phone[:20]
            ifisc = safe_str(r.get("IFISC"))
            if ifisc and not self.tenant.nif:
                self.tenant.nif = ifisc[:20]
            self.tenant.save()
            break

    def _import_suppliers(self):
        self.log("Importing Suppliers...")
        # 1. From FOURNISS.DBF
        records = self.get_dbf("FOURNISS.DBF")
        for r in records:
            name = safe_str(r.get("RAISON"))
            if not name: continue
            supp, _ = Supplier.objects.update_or_create(
                tenant=self.tenant,
                name=name,
                defaults={
                    "phone": safe_str(r.get("TELEPHONE")),
                    "address": safe_str(r.get("ADRESSE")),
                    "outstanding_balance": safe_decimal(r.get("MT_RESTE"))
                }
            )
            code = safe_str(r.get("CODE_FOURN"))
            if code:
                self.supplier_map[code] = supp
            self.supplier_map[name] = supp
            self.stats["suppliers_imported"] += 1

        # 2. In Algerian retail dBase systems, wholesale vendors/importers are recorded in CLIENT.DBF
        # (e.g. CHINA, GHOLEM GROS)
        client_records = self.get_dbf("CLIENT.DBF")
        for r in client_records:
            cid = safe_str(r.get("CLIENT"))
            name = safe_str(r.get("DESIGNAT"))
            if not name or "DETAIL" in name.upper() or "COMPTOIR" in name.upper():
                continue
            supp, created = Supplier.objects.get_or_create(
                tenant=self.tenant,
                name=name,
                defaults={
                    "phone": safe_str(r.get("TEL1")),
                    "address": safe_str(r.get("ADRESSE")),
                }
            )
            self.supplier_map[cid] = supp
            self.supplier_map[name] = supp
            if created:
                self.stats["suppliers_imported"] += 1

        # 3. Utility / General Expense Suppliers from FOURND.DBF (PTT, Sonelgaz, etc.)
        fournd_records = self.get_dbf("FOURND.DBF")
        for r in fournd_records:
            fid = safe_str(r.get("FOURND"))
            lib = safe_str(r.get("LIBELLE"))
            if not lib: continue
            supp, created = Supplier.objects.get_or_create(
                tenant=self.tenant,
                name=lib,
                defaults={"notes": f"Fournisseur de charges/dépenses (FOURND #{fid})"}
            )
            self.supplier_map[f"FOURND_{fid}"] = supp
            if created:
                self.stats["suppliers_imported"] += 1

    def _import_clients(self):
        self.log("Importing Clients...")
        file_name = "CLIENTB.DBF" if self.software_type == "wholesale" else "CLIENT.DBF"
        records = self.get_dbf(file_name)
        for r in records:
            name = safe_str(r.get("DESIGNAT"))
            if not name: continue
            
            phone = safe_str(r.get("TEL1"))
            client_type = "wholesale" if self.software_type == "wholesale" else "retail"
            nif = safe_str(r.get("IFISC"))[:20] if self.software_type == "wholesale" else ""
            rc = safe_str(r.get("REG_COM"))[:30] if self.software_type == "wholesale" else ""
            
            client, created = Client.objects.get_or_create(
                tenant=self.tenant,
                name=name,
                defaults={
                    "phone": phone[:20],
                    "address": safe_str(r.get("ADRESSE")),
                    "client_type": client_type,
                    "nif": nif,
                    "rc": rc,
                }
            )
            if not created:
                client.phone = phone[:20]
                client.address = safe_str(r.get("ADRESSE"))
                client.client_type = client_type
                client.nif = nif
                client.rc = rc
                client.save(update_fields=['phone', 'address', 'client_type', 'nif', 'rc'])

            legacy_client_id = safe_str(r.get("CLIENT")) or name
            self.client_map[legacy_client_id] = client

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

        file_name = "ARTICLE.DBF" if self.software_type == "wholesale" else "ARTICLEB.DBF"
        records = self.get_dbf(file_name)

        # Pre-cache existing products by reference for maximum performance
        existing_products = {
            p.reference: p
            for p in Product.objects.filter(tenant=self.tenant).exclude(reference="")
        }

        # Pre-cache existing variants
        existing_variants = {}
        for v in Variant.objects.filter(tenant=self.tenant):
            existing_variants[(v.product_id, v.size_eu, v.colour)] = v

        for r in records:
            ref = safe_str(r.get("REFERENCE"))
            label = safe_str(r.get("LIBELLE"))
            
            # In Algerian shoe stores, Reference is the keyword used to search for products.
            # Label is only used for description.
            name = ref if ref else label
            if not name:
                name = f"Article {r.get('ARTICLE')}"
            
            fam = safe_str(r.get("FAMILLE"))
            cat_name = family_map.get(fam, "")
            gender, category, default_sizes = get_family_details(cat_name)
            
            description = label if label else cat_name
            pairs_per_carton = safe_int(r.get("NOMBRE")) or 10
            
            wholesale_price = safe_decimal(r.get("BTARIF2"))
            if wholesale_price <= 0:
                wholesale_price = safe_decimal(r.get("BTARIF1"))
            
            purchase_price = safe_decimal(r.get("PRIX_ACHAT"))
            if purchase_price <= 0:
                purchase_price = safe_decimal(r.get("PU_ACHATBL"))

            sale_price = safe_decimal(r.get("BTARIF1"))
            if sale_price <= 0:
                sale_price = safe_decimal(r.get("PV_TARIF1"))

            prod = existing_products.get(ref)
            if not prod:
                prod = Product.objects.create(
                    tenant=self.tenant,
                    reference=ref,
                    name=name[:200],
                    description=description,
                    category=category,
                    gender=gender,
                    purchase_price=purchase_price,
                    sale_price=sale_price,
                    wholesale_price=wholesale_price,
                    pairs_per_carton=pairs_per_carton,
                )
                if ref:
                    existing_products[ref] = prod
            else:
                prod.name = name[:200]
                prod.description = description
                prod.purchase_price = purchase_price
                prod.sale_price = sale_price
                prod.wholesale_price = wholesale_price
                prod.save(update_fields=["name", "description", "purchase_price", "sale_price", "wholesale_price"])
            
            st_bl = safe_int(r.get("ST_BL"))
            if st_bl <= 0:
                st_bl = safe_int(r.get("ST_ACTUEL"))

            legacy_id = safe_str(r.get("ARTICLE"))

            if self.easy_mode:
                # ── Easy Mode: Exactly 1 default variant per product (size_eu=0, colour='Standard') ──
                var_key = (prod.id, 0, "Standard")
                var = existing_variants.get(var_key)
                if not var:
                    var = Variant.objects.create(
                        tenant=self.tenant,
                        product=prod,
                        size_eu=0,
                        colour="Standard",
                    )
                    existing_variants[var_key] = var

                if st_bl > 0:
                    StockMovement.objects.create(
                        tenant=self.tenant,
                        branch=self.branch,
                        variant=var,
                        quantity_delta=st_bl,
                        reason=MovementReasonChoices.INITIAL,
                        notes=f"Stock initial importé de l'ancienne base ({st_bl} paires)"
                    )
                    self.stats["stock_units_imported"] += st_bl

                self.product_map[legacy_id] = var
                self.stats["products_imported"] += 1
            else:
                # ── Matrix Mode: Distribute stock across size range ──
                sizes = default_sizes
                if self.software_type == "wholesale":
                    sizes = parse_pointure_range(r.get("POINTURE"), default_sizes)

                stock_distribution = distribute_quantity(st_bl, sizes)
                middle_variant = None
                middle_size = sizes[len(sizes) // 2]
                
                for sz in sizes:
                    var_key = (prod.id, sz, "Standard")
                    var = existing_variants.get(var_key)
                    if not var:
                        var = Variant.objects.create(
                            tenant=self.tenant,
                            product=prod,
                            size_eu=sz,
                            colour="Standard"
                        )
                        existing_variants[var_key] = var

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
                
                self.product_map[legacy_id] = middle_variant or var
                self.stats["products_imported"] += 1

    def _import_purchases(self):
        """
        Imports historical purchase delivery invoices from ACHATART.DBF & ACHATMVT.DBF.
        """
        self.log("Importing Purchase Invoices & Orders (ACHAT)...")
        mvt_records = self.get_dbf("ACHATMVT.DBF")
        if not mvt_records:
            return

        header_records = self.get_dbf("ACHATART.DBF")
        headers_by_facture = {}
        for h in header_records:
            f_num = safe_str(h.get("FACTURE"))
            if f_num:
                headers_by_facture[f_num] = h

        # Group lines by FACTURE
        mvts_by_facture = {}
        for m in mvt_records:
            f_num = safe_str(m.get("FACTURE"))
            if not f_num:
                continue
            if f_num not in mvts_by_facture:
                mvts_by_facture[f_num] = []
            mvts_by_facture[f_num].append(m)

        for f_num, lines in mvts_by_facture.items():
            header = headers_by_facture.get(f_num, {})
            client_id = safe_str(header.get("CLIENT") or lines[0].get("CLIENT"))
            supplier = self.supplier_map.get(client_id)
            if not supplier:
                supplier = Supplier.objects.filter(tenant=self.tenant).first()
            if not supplier:
                supplier = Supplier.objects.create(
                    tenant=self.tenant,
                    name=f"Fournisseur Facture #{f_num}"
                )
                self.supplier_map[client_id] = supplier

            date_fact = header.get("DATE_FACT") or lines[0].get("DATE_FACT")
            if not date_fact:
                date_fact = datetime.date.today()

            total_amount = safe_decimal(header.get("MT_HT"))
            calculated_total = Decimal("0.00")
            po_lines_data = []

            for line in lines:
                legacy_art = safe_str(line.get("ARTICLE"))
                var = self.product_map.get(legacy_art)
                qty = safe_int(line.get("QUANTITE")) or 1
                cartons = safe_int(line.get("NOMBRE")) or 1
                pu = safe_decimal(line.get("PRIX_ACHAT"))
                if pu <= 0 and var:
                    pu = var.product.purchase_price
                if pu <= 0:
                    pu = safe_decimal(line.get("PRIX_VENTE"))

                calculated_total += qty * pu
                desc = var.product.name if var else f"Article {legacy_art}"
                po_lines_data.append({
                    "variant": var,
                    "description": desc,
                    "quantity_ordered": qty,
                    "quantity_received": qty,
                    "cartons": cartons,
                    "pairs_per_carton": var.product.pairs_per_carton if var else 10,
                    "agreed_unit_price": pu,
                })

            if total_amount <= 0:
                total_amount = calculated_total

            po = PurchaseOrder.objects.create(
                tenant=self.tenant,
                supplier=supplier,
                status=POStatusChoices.RECEIVED,
                reference=f"ACHAT-{f_num}",
                total_amount=total_amount,
                notes=f"Facture d'achat importée N° {f_num}",
                expected_date=date_fact,
            )
            if isinstance(date_fact, datetime.date):
                po.created_at = datetime.datetime.combine(date_fact, datetime.time(12, 0))
                po.save(update_fields=["created_at"])

            for pld in po_lines_data:
                POLine.objects.create(
                    order=po,
                    variant=pld["variant"],
                    description=pld["description"],
                    quantity_ordered=pld["quantity_ordered"],
                    quantity_received=pld["quantity_received"],
                    cartons=pld["cartons"],
                    pairs_per_carton=pld["pairs_per_carton"],
                    agreed_unit_price=pld["agreed_unit_price"],
                )

            self.stats["purchase_orders_imported"] = self.stats.get("purchase_orders_imported", 0) + 1

    def _import_defects(self):
        self.log("Importing Defective Items from Legacy Purchases...")
        records = self.get_dbf("ACHATART.DBF") or self.get_dbf("ACHATMVT.DBF")
        if not records:
            return
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
        if self.software_type == "wholesale":
            self._import_invoices()
            return

        self.log("Importing Historical Sales (Retail)...")
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

                # Exact hour of the sale from OUAKTE if present (e.g. '14', '18')
                hour = 12
                ouakte = safe_str(items[0].get("OUAKTE"))
                if ouakte and ouakte.isdigit():
                    h = int(ouakte)
                    if 0 <= h <= 23:
                        hour = h
                
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
                    sale.created_at = datetime.datetime.combine(data["date"], datetime.time(hour, 0))
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

    def _import_invoices(self):
        self.log("Importing Historical Invoices (Wholesale)...")
        from apps.invoicing.models import Invoice, InvoiceLine, InvoiceStatusChoices
        sales_files = ["VENTEMVT.DBF", "VENTMVTX.DBF"]
        
        for file in sales_files:
            records = self.get_dbf(file)
            if not records: continue
            
            invoice_group = {}
            for r in records:
                num = safe_str(r.get("FACTURE"))
                date_fact = r.get("DATE_FACT")
                if not date_fact: date_fact = datetime.date.today()
                
                key = f"{num}_{date_fact}"
                if key not in invoice_group:
                    invoice_group[key] = {"date": date_fact, "num": num, "client": safe_str(r.get("CLIENT")), "items": []}
                invoice_group[key]["items"].append(r)
                
            for key, data in invoice_group.items():
                items = data["items"]
                total_amount = Decimal("0.00")
                invoice_lines_data = []
                
                for x in items:
                    qte = safe_decimal(x.get("QUANTITE"))
                    pv = safe_decimal(x.get("PRIX_VENTE"))
                    legacy_id = safe_str(x.get("ARTICLE"))
                    
                    if qte == 0: continue
                    if legacy_id not in self.product_map: continue
                    
                    var = self.product_map[legacy_id]
                    subtotal = qte * pv
                    total_amount += subtotal
                    
                    invoice_lines_data.append({
                        "variant": var,
                        "quantity": qte,
                        "unit_price": pv,
                    })
                    
                if not invoice_lines_data: continue
                
                client = self.client_map.get(data["client"])
                
                invoice = Invoice.objects.create(
                    tenant=self.tenant,
                    branch=self.branch,
                    client=client,
                    number=data["num"][:30],
                    date=data["date"],
                    due_date=data["date"],
                    status=InvoiceStatusChoices.PAID,
                    total_ht=total_amount,
                    tva_amount=Decimal("0.00"),
                    total_ttc=total_amount,
                    is_formal=False,
                )
                
                for sid in invoice_lines_data:
                    desc_size = f" - Size {sid['variant'].size_eu}" if sid['variant'].size_eu > 0 else ""
                    InvoiceLine.objects.create(
                        invoice=invoice,
                        variant=sid["variant"],
                        quantity=sid["quantity"],
                        unit_price=sid["unit_price"],
                        description=f"{sid['variant'].product.name}{desc_size}",
                    )
                    
                self.stats["sales_imported"] += 1
