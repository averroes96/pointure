"""
Management command: python manage.py seed_demo

Creates a complete, rich demo dataset for development, testing, and user guide demonstration:
  - 1 Tenant: "ShoeDZ Demo Store" with tax identification (NIS, NIF, RC, AI)
  - Configured StoreSettings (Mixed wholesale/retail mode, variants, fiscal regime Réel)
  - 3 Users: Owner, Manager, Cashier
  - 2 Branches: Alger Centre (HQ), Bab Ezzouar
  - 20 Footwear Products with:
      * 3 price tiers (Détail, Demi-Gros, Gros)
      * Cartons per series & exact breakdown
      * Plage/série de pointures (ex: 39/44, 36/41)
      * Emplacement casier / rayon avec plage (ex: Casier C-20 (39/44))
      * Full variant matrix & initial stock
  - 6 Clients with price tiers (gros, demi-gros, détail) and 1 blocked credit-risk client
  - 3 Footwear Suppliers with contact information
  - 3 Purchase Orders (Received, Ordered in transit, Draft) with cartons and lines
  - 3 Quotes / Proforma Invoices (Sent, Draft, Converted) with wholesale tiers & cartons
  - 2 Delivery Notes (Bons de Livraison) with cartons
  - 3 Pending cheques in calendar
  - 30 Sales over the last 30 days
  - 10 Invoices in various statuses
  - Programmatic generation of sample import fixtures in fixtures/demo_imports/ (Legacy DBF, PO Excel/CSV, Products)
"""
import random
from datetime import date, timedelta
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone


BRANDS = ["Nike", "Adidas", "Puma", "Reebok", "New Balance", "Skechers", "Vans", "Converse", "Clarks", "Geox"]
COLOURS = ["Noir", "Blanc", "Rouge", "Bleu", "Marron", "Gris", "Beige", "Kaki"]
CATEGORIES = ["sneakers", "boots", "sandals", "formal", "sport"]
PRODUCT_NAMES = [
    "Air Max Pro", "Ultra Boost Foam", "Classic Leather Club", "Chuck Canvas High", "Old Skool Skate",
    "Stan Court White", "Forum Street Low", "Suede Classic Urban", "Cortez Track", "Blazer Mid Vintage",
    "574 Heritage", "990v5 Cushioned", "Club C Revenge", "Classic City Loafer", "Gel-Nimbus Distance",
    "GTS Speed Trainer", "Fresh Foam Trail", "Superstar Shelltoe", "Gazelle Indoor", "Handball Spezial Gum",
]

CLIENT_DATA = [
    ("Boutique El Amine Gros", "05 55 11 22 33", "16", "wholesale", "gros", Decimal("500000.00"), False, ""),
    ("Chaussures Didouche Demi-Gros", "05 55 44 55 66", "16", "wholesale", "demi_gros", Decimal("300000.00"), False, ""),
    ("Maison du Sport Oran", "05 55 77 88 99", "31", "wholesale", "gros", Decimal("400000.00"), False, ""),
    ("Mode & Style Détail", "05 55 00 11 22", "25", "retail", "detail", Decimal("50000.00"), False, ""),
    ("Tendances Footwear Blida", "05 55 33 44 55", "09", "retail", "detail", Decimal("100000.00"), False, ""),
    ("Sarl Distri-Risk Impayé", "05 55 99 88 77", "16", "wholesale", "gros", Decimal("200000.00"), True, "Plafond de crédit dépassé et chèques impayés."),
]

SUPPLIERS_DATA = [
    ("Sarl El Eulma Import Chaussures", "036 88 11 22", "Zone Commerciale Dubai, El Eulma, Sétif", "M. Bouzid", "Importateur direct Turquie & Chine"),
    ("Manufacture Cuir Tlemcen", "043 20 15 30", "Zone Industrielle Chetouane, Tlemcen", "M. Mansouri", "Fabricant national chaussures cuir véritable"),
    ("Distribution Sport Alger", "023 55 44 33", "Zone d'Activité Dar El Beida, Alger", "M. Belkacem", "Grossiste sneakers et articles de sport"),
]


class Command(BaseCommand):
    help = "Seed the database with rich demo data for development and demonstrations."

    def add_arguments(self, parser):
        parser.add_argument("--reset", action="store_true", help="Delete existing demo data first.")

    @transaction.atomic
    def handle(self, *args, **options):
        self.stdout.write(self.style.MIGRATE_HEADING("🌱 Seeding comprehensive demo data..."))

        from apps.core.models import (
            Branch, BusinessModeChoices, PlanChoices, RoleChoices, StoreSettings, TaxRegimeChoices, Tenant, User
        )

        if options.get("reset"):
            self.stdout.write("  Cleaning up existing demo data...")
            Tenant.objects.filter(name="ShoeDZ Demo Store").delete()

        # ── 1. Tenant ───────────────────────────────────────────────────────────
        tenant, created = Tenant.objects.get_or_create(
            name="ShoeDZ Demo Store",
            defaults={
                "plan": PlanChoices.PRO_WHOLESALE,
                "nif": "123456789012345",
                "nis": "123456789012345",
                "rc": "16/00-1234567 B 20",
                "ai": "16234567890",
                "phone": "023 00 00 00",
                "address": "12 Rue de la Paix, Alger",
                "wilaya": "16",
            },
        )
        if not created:
            tenant.plan = PlanChoices.PRO_WHOLESALE
            tenant.nif = "123456789012345"
            tenant.nis = "123456789012345"
            tenant.rc = "16/00-1234567 B 20"
            tenant.ai = "16234567890"
            tenant.phone = "023 00 00 00"
            tenant.address = "12 Rue de la Paix, Alger"
            tenant.wilaya = "16"
            tenant.save()
        self.stdout.write(f"  ✓ Tenant: {tenant.name} (Plan: Pro Wholesale, NIF/NIS: 123456789012345)")

        # ── 2. StoreSettings ────────────────────────────────────────────────────
        settings_obj, _ = StoreSettings.objects.get_or_create(tenant=tenant)
        settings_obj.business_mode = BusinessModeChoices.MIXED
        settings_obj.tax_regime = TaxRegimeChoices.REEL
        settings_obj.enable_variants = True
        settings_obj.allow_negative_stock = False
        settings_obj.invoice_legal_mentions = "Exonéré de TVA selon l'art. 9 du CTCA — SARL au capital de 10.000.000 DZD."
        settings_obj.save()
        self.stdout.write("  ✓ StoreSettings: Mixed mode, Réel tax regime, variants enabled")

        # ── 3. Users ────────────────────────────────────────────────────────────
        owner, _ = User.objects.get_or_create(
            email="admin@demo.com",
            defaults={
                "tenant": tenant,
                "phone": "0555000001",
                "role": RoleChoices.OWNER,
                "first_name": "Admin",
                "last_name": "Owner",
                "is_staff": True,
            },
        )
        if not owner.phone:
            owner.phone = "0555000001"
        owner.set_password("demo1234")
        owner.save()

        manager, _ = User.objects.get_or_create(
            email="manager@demo.com",
            defaults={
                "tenant": tenant,
                "phone": "0555000002",
                "role": RoleChoices.MANAGER,
                "first_name": "Karim",
                "last_name": "Manager",
            },
        )
        if not manager.phone:
            manager.phone = "0555000002"
        manager.set_password("demo1234")
        manager.save()

        cashier, _ = User.objects.get_or_create(
            email="cashier@demo.com",
            defaults={
                "tenant": tenant,
                "phone": "0555000003",
                "role": RoleChoices.CASHIER,
                "first_name": "Yacine",
                "last_name": "Cashier",
            },
        )
        if not cashier.phone:
            cashier.phone = "0555000003"
        cashier.set_password("demo1234")
        cashier.save()
        self.stdout.write("  ✓ Users: admin@demo.com / manager@demo.com / cashier@demo.com (password: demo1234)")

        # ── 4. Branches ─────────────────────────────────────────────────────────
        branch1, _ = Branch.objects.get_or_create(
            tenant=tenant, name="Alger Centre",
            defaults={"address": "Rue Didouche Mourad, Alger", "wilaya": "16", "is_headquarters": True}
        )
        branch2, _ = Branch.objects.get_or_create(
            tenant=tenant, name="Bab Ezzouar",
            defaults={"address": "Centre Commercial Bab Ezzouar", "wilaya": "16"}
        )
        branches = [branch1, branch2]
        self.stdout.write("  ✓ Branches: Alger Centre (HQ), Bab Ezzouar")

        # ── 5. Products & Variants with 3 Price Tiers & Shelves ──────────────────
        from apps.inventory.models import MovementReasonChoices, Product, ProductLocation, StockMovement, Variant

        products = []
        for i, name in enumerate(PRODUCT_NAMES):
            brand = BRANDS[i % len(BRANDS)]
            category = CATEGORIES[i % len(CATEGORIES)]
            gender = "F" if category == "sandals" else ("M" if category in ("formal", "boots") else "U")

            purchase = Decimal(str(random.randint(2200, 5500)))
            wholesale = (purchase * Decimal("1.25")).quantize(Decimal("50"))
            semi = (purchase * Decimal("1.45")).quantize(Decimal("50"))
            sale = (purchase * Decimal("1.75")).quantize(Decimal("50"))

            # Sizing and series breakdown
            if gender == "F":
                pairs = 10
                breakdown = {"36": 1, "37": 2, "38": 3, "39": 2, "40": 1, "41": 1}
                size_range = "36/41"
                variant_sizes = [36, 37, 38, 39, 40, 41]
            elif category == "boots":
                pairs = 10
                breakdown = {"40": 2, "41": 3, "42": 3, "43": 2}
                size_range = "40/43"
                variant_sizes = [40, 41, 42, 43]
            else:
                pairs = 12
                breakdown = {"39": 1, "40": 2, "41": 3, "42": 3, "43": 2, "44": 1}
                size_range = "39/44"
                variant_sizes = [39, 40, 41, 42, 43, 44]

            p, _ = Product.objects.get_or_create(
                tenant=tenant,
                name=name,
                brand=brand,
                defaults={
                    "category": category,
                    "gender": gender,
                    "reference": f"REF-{brand[:2].upper()}-{i+1:03d}",
                    "purchase_price": purchase,
                    "wholesale_price": wholesale,
                    "semi_wholesale_price": semi,
                    "sale_price": sale,
                    "pairs_per_carton": pairs,
                    "carton_breakdown": breakdown,
                    "size_range": size_range,
                    "alert_threshold": 6,
                },
            )
            # Update wholesale pricing and size range in case product existed
            p.wholesale_price = wholesale
            p.semi_wholesale_price = semi
            p.pairs_per_carton = pairs
            p.carton_breakdown = breakdown
            p.size_range = size_range
            p.save()
            products.append(p)

            # Location shelving (e.g. Casier C-20 (39/44))
            shelf_code = f"C{20 + i}" if i < 10 else f"R{10 + (i-10)}"
            ProductLocation.objects.update_or_create(
                tenant=tenant,
                branch=branch1,
                product=p,
                defaults={"location": f"{shelf_code} ({p.size_range})"},
            )

            # Create variants & initial stock
            colours = ["Noir", "Blanc", "Marron"] if gender == "M" else ["Noir", "Beige", "Blanc"]
            for size in variant_sizes:
                for colour in colours:
                    v, v_created = Variant.objects.get_or_create(
                        tenant=tenant, product=p, size_eu=size, colour=colour,
                        defaults={"alert_threshold": 2},
                    )
                    if v_created:
                        qty = random.randint(4, 16)
                        StockMovement.objects.create(
                            tenant=tenant,
                            variant=v,
                            branch=branch1,
                            quantity_delta=qty,
                            reason=MovementReasonChoices.INITIAL,
                            user=owner,
                        )

        self.stdout.write(f"  ✓ Products: {len(products)} models with 3 price tiers, series breakdowns, and shelf locations")

        # ── 6. Clients with Wholesale Price Tiers & Risk Profile ─────────────────
        from apps.clients.models import Client, ClientLedger, ClientTypeChoices, PriceTierChoices

        clients = []
        for name, phone, wilaya, ctype, tier, limit, is_blocked, notes in CLIENT_DATA:
            c, _ = Client.objects.get_or_create(
                tenant=tenant, name=name,
                defaults={
                    "phone": phone,
                    "wilaya": wilaya,
                    "client_type": ClientTypeChoices.WHOLESALE if ctype == "wholesale" else ClientTypeChoices.RETAIL,
                    "price_tier": getattr(PriceTierChoices, tier.upper()),
                    "credit_limit": limit,
                    "is_blocked": is_blocked,
                    "notes": notes,
                    "nif": f"00{random.randint(10000000, 99999999)}0001",
                    "rc": f"{wilaya}/00-{random.randint(1000000, 9999999)} B 20",
                },
            )
            # Ensure tier and blocked flags are current
            c.client_type = ClientTypeChoices.WHOLESALE if ctype == "wholesale" else ClientTypeChoices.RETAIL
            c.price_tier = getattr(PriceTierChoices, tier.upper())
            c.credit_limit = limit
            c.is_blocked = is_blocked
            c.notes = notes
            c.save()

            if is_blocked and c.ledger_entries.count() == 0:
                # Add opening debit to exceed credit limit
                ClientLedger.objects.create(
                    client=c,
                    entry_type="debit",
                    amount=Decimal("320000.00"),
                    date=timezone.localdate() - timedelta(days=25),
                    description="Solde impayé facture précédente (Dépassement de plafond)",
                )

            clients.append(c)

        self.stdout.write(f"  ✓ Clients: {len(clients)} accounts (wholesale tiers gros/demi-gros + 1 blocked credit risk)")

        # ── 7. Suppliers ────────────────────────────────────────────────────────
        from apps.suppliers.models import (
            POLine, POStatusChoices, PurchaseOrder, Supplier, SupplierInvoice, SupplierPayment
        )

        suppliers = []
        for sname, sphone, saddr, contact, notes in SUPPLIERS_DATA:
            supp, _ = Supplier.objects.get_or_create(
                tenant=tenant,
                name=sname,
                defaults={
                    "phone": sphone,
                    "address": saddr,
                    "contact_name": contact,
                    "notes": notes,
                },
            )
            suppliers.append(supp)

        self.stdout.write(f"  ✓ Suppliers: {len(suppliers)} footwear manufacturers and importers")

        # ── 8. Purchase Orders (Received, Ordered, Draft) ────────────────────────
        all_variants = list(Variant.objects.filter(tenant=tenant)[:40])
        today = timezone.localdate()

        # PO 1: Received
        po1, _ = PurchaseOrder.objects.get_or_create(
            tenant=tenant,
            reference="BC-2026-001",
            defaults={
                "supplier": suppliers[0],
                "status": POStatusChoices.RECEIVED,
                "notes": "Commande de réassort sneakers été réceptionnée.",
                "total_amount": Decimal("134400.00"),
                "created_by": owner,
            },
        )
        if po1.lines.count() == 0 and all_variants:
            v1, v2 = all_variants[0], all_variants[1]
            POLine.objects.create(
                order=po1, variant=v1, description=f"{v1.product.name} EU{v1.size_eu} {v1.colour}",
                quantity_ordered=24, quantity_received=24, cartons=2, pairs_per_carton=12,
                agreed_unit_price=v1.product.purchase_price,
            )
            POLine.objects.create(
                order=po1, variant=v2, description=f"{v2.product.name} EU{v2.size_eu} {v2.colour}",
                quantity_ordered=24, quantity_received=24, cartons=2, pairs_per_carton=12,
                agreed_unit_price=v2.product.purchase_price,
            )
            po1.total_amount = sum(l.line_total for l in po1.lines.all())
            po1.save(update_fields=["total_amount"])

            # Create supplier invoice
            sup_inv, _ = SupplierInvoice.objects.get_or_create(
                tenant=tenant,
                supplier=suppliers[0],
                invoice_number="FAC-EULMA-2026-88",
                defaults={
                    "purchase_order": po1,
                    "date": today - timedelta(days=5),
                    "due_date": today + timedelta(days=25),
                    "total_amount": po1.total_amount,
                },
            )
            SupplierPayment.objects.get_or_create(
                tenant=tenant,
                supplier=suppliers[0],
                supplier_invoice=sup_inv,
                defaults={
                    "amount": (po1.total_amount * Decimal("0.5")).quantize(Decimal("1")),
                    "method": "cheque",
                    "cheque_number": "CHQ-889900",
                    "bank": "BNA",
                    "date": today - timedelta(days=3),
                    "recorded_by": manager,
                },
            )

        # PO 2: In transit (Sent)
        po2, _ = PurchaseOrder.objects.get_or_create(
            tenant=tenant,
            reference="BC-2026-002",
            defaults={
                "supplier": suppliers[1],
                "status": POStatusChoices.SENT,
                "expected_date": today + timedelta(days=5),
                "notes": "Commande bottines cuir en cours d'acheminement depuis Tlemcen.",
                "total_amount": Decimal("175000.00"),
                "created_by": manager,
            },
        )
        if po2.lines.count() == 0 and len(all_variants) > 3:
            v3, v4 = all_variants[2], all_variants[3]
            POLine.objects.create(
                order=po2, variant=v3, description=f"{v3.product.name} EU{v3.size_eu} {v3.colour}",
                quantity_ordered=30, quantity_received=0, cartons=3, pairs_per_carton=10,
                agreed_unit_price=v3.product.purchase_price,
            )
            POLine.objects.create(
                order=po2, variant=v4, description=f"{v4.product.name} EU{v4.size_eu} {v4.colour}",
                quantity_ordered=20, quantity_received=0, cartons=2, pairs_per_carton=10,
                agreed_unit_price=v4.product.purchase_price,
            )
            po2.total_amount = sum(l.line_total for l in po2.lines.all())
            po2.save(update_fields=["total_amount"])

        # PO 3: Draft
        po3, _ = PurchaseOrder.objects.get_or_create(
            tenant=tenant,
            reference="BC-2026-003",
            defaults={
                "supplier": suppliers[2],
                "status": POStatusChoices.DRAFT,
                "notes": "Brouillon réassort rentrée scolaire.",
                "total_amount": Decimal("0.00"),
                "created_by": manager,
            },
        )
        if po3.lines.count() == 0 and len(all_variants) > 5:
            v5 = all_variants[4]
            POLine.objects.create(
                order=po3, variant=v5, description=f"{v5.product.name} EU{v5.size_eu} {v5.colour}",
                quantity_ordered=24, quantity_received=0, cartons=2, pairs_per_carton=12,
                agreed_unit_price=v5.product.purchase_price,
            )
            po3.total_amount = sum(l.line_total for l in po3.lines.all())
            po3.save(update_fields=["total_amount"])

        self.stdout.write("  ✓ Purchase Orders: 3 orders (Received, Sent, Draft) with carton tracking")

        # ── 9. Quotes / Proforma Invoices ───────────────────────────────────────
        from apps.invoicing.models import Quote, QuoteLine, QuoteStatusChoices

        wholesale_client = clients[0]  # Boutique El Amine Gros
        semi_client = clients[1]       # Chaussures Didouche Demi-Gros

        # Quote 1: Sent (Proforma with wholesale price and cartons)
        q1, _ = Quote.objects.get_or_create(
            tenant=tenant,
            number="PF-2026-00001",
            defaults={
                "client": wholesale_client,
                "branch": branch1,
                "date": today - timedelta(days=3),
                "valid_until": today + timedelta(days=27),
                "status": QuoteStatusChoices.SENT,
                "apply_tva": True,
                "tva_rate": Decimal("19.00"),
                "created_by": manager,
                "notes": "Offre tarif gros valable 30 jours. Livraison offerte par carton cerclé.",
            },
        )
        if q1.lines.count() == 0 and all_variants:
            for idx, v in enumerate(all_variants[:3]):
                QuoteLine.objects.create(
                    quote=q1,
                    variant=v,
                    description=f"{v.product.brand} {v.product.name} — EU{v.size_eu} {v.colour}",
                    quantity=Decimal("24.00"),
                    unit_price=v.product.wholesale_price,
                    discount_pct=Decimal("5.00") if idx == 0 else Decimal("0.00"),
                    cartons=2,
                    order=idx,
                    unit_cost=v.product.purchase_price,
                )
            q1.compute_totals()
            q1.save(update_fields=["total_ht", "tva_amount", "total_ttc"])

        # Quote 2: Draft
        q2, _ = Quote.objects.get_or_create(
            tenant=tenant,
            number="PF-2026-00002",
            defaults={
                "client": semi_client,
                "branch": branch1,
                "date": today - timedelta(days=1),
                "valid_until": today + timedelta(days=14),
                "status": QuoteStatusChoices.DRAFT,
                "apply_tva": False,
                "created_by": cashier,
                "notes": "Devis demi-gros en préparation.",
            },
        )
        if q2.lines.count() == 0 and len(all_variants) > 4:
            for idx, v in enumerate(all_variants[3:5]):
                QuoteLine.objects.create(
                    quote=q2,
                    variant=v,
                    description=f"{v.product.brand} {v.product.name} — EU{v.size_eu} {v.colour}",
                    quantity=Decimal("12.00"),
                    unit_price=v.product.semi_wholesale_price or v.product.sale_price,
                    cartons=1,
                    order=idx,
                    unit_cost=v.product.purchase_price,
                )
            q2.compute_totals()
            q2.save(update_fields=["total_ht", "tva_amount", "total_ttc"])

        self.stdout.write("  ✓ Quotes / Proformas: 2 proformas (Sent, Draft) with carton series")

        # ── 10. Cheques ─────────────────────────────────────────────────────────
        from apps.clients.models import Cheque

        cheque_dates = [today + timedelta(days=2), today + timedelta(days=5), today + timedelta(days=12)]
        for i, due_date in enumerate(cheque_dates):
            Cheque.objects.get_or_create(
                tenant=tenant,
                number=f"CH-2026-{i+1:03d}",
                defaults={
                    "client": clients[i],
                    "direction": "receivable",
                    "bank": ["BNA", "CPA", "BEA"][i % 3],
                    "amount": Decimal(str(random.randint(50000, 200000))),
                    "due_date": due_date,
                },
            )
        self.stdout.write("  ✓ Cheques: 3 pending in calendar")

        # ── 11. Sales ───────────────────────────────────────────────────────────
        from apps.sales.models import Payment, Sale, SaleItem

        sale_count = Sale.objects.filter(tenant=tenant).count()
        if sale_count == 0:
            for day_offset in range(30):
                sale_date = timezone.now() - timedelta(days=day_offset)
                num_sales = random.randint(1, 4)
                for _ in range(num_sales):
                    if not all_variants:
                        break
                    branch = random.choice(branches)
                    variant = random.choice(all_variants)

                    total = variant.product.sale_price * random.randint(1, 3)
                    date_str = sale_date.strftime("%Y%m%d")
                    seq = Sale.objects.filter(
                        tenant=tenant, receipt_number__startswith=f"RC-{date_str}"
                    ).count() + 1
                    receipt = f"RC-{date_str}-{seq:04d}"

                    sale = Sale.objects.create(
                        tenant=tenant,
                        branch=branch,
                        cashier=cashier,
                        total_amount=total,
                        receipt_number=receipt,
                        created_at=sale_date,
                    )
                    SaleItem.objects.create(
                        sale=sale,
                        variant=variant,
                        quantity=1,
                        unit_price=variant.product.sale_price,
                    )
                    Payment.objects.create(
                        sale=sale,
                        amount=total,
                        method=random.choice(["cash", "ccp"]),
                    )
                    StockMovement.objects.create(
                        tenant=tenant,
                        variant=variant,
                        branch=branch,
                        quantity_delta=-1,
                        reason=MovementReasonChoices.SALE,
                        reference_id=str(sale.pk),
                        reference_type="Sale",
                        user=cashier,
                    )
                    sale_count += 1

        self.stdout.write(f"  ✓ Sales: {sale_count} transactions over last 30 days")

        # ── 12. Invoices & Delivery Notes (Bons de Livraison) ────────────────────
        from apps.invoicing.models import (
            DeliveryNote, DeliveryNoteLine, Invoice, InvoiceCounter, InvoiceLine, InvoicePayment
        )

        statuses = ["paid", "paid", "partial", "sent", "overdue", "draft", "sent", "partial", "paid", "overdue"]
        created_invoices = []
        for i, inv_status in enumerate(statuses):
            client = clients[i % len(clients)]
            inv_date = today - timedelta(days=i * 7)
            due = inv_date + timedelta(days=30)
            inv_number = f"FA-2026-{i+1:05d}"

            inv = Invoice.objects.filter(tenant=tenant, number=inv_number).first()
            is_new = False
            if not inv:
                inv = Invoice.objects.create(
                    tenant=tenant,
                    number=inv_number,
                    client=client,
                    branch=branch1,
                    series_prefix="FA",
                    date=inv_date,
                    due_date=due,
                    status=inv_status,
                    apply_tva=True,
                    tva_rate=Decimal("19.00"),
                    created_by=manager,
                )
                is_new = True

            if is_new:
                for j in range(3):
                    if all_variants:
                        v = random.choice(all_variants)
                        InvoiceLine.objects.create(
                            invoice=inv,
                            variant=v,
                            description=f"{v.product.brand} {v.product.name} — EU{v.size_eu} {v.colour}",
                            quantity=Decimal(str(random.randint(10, 50))),
                            unit_price=v.product.sale_price,
                            order=j,
                        )
                inv.compute_totals()
                inv.save(update_fields=["total_ht", "tva_amount", "total_ttc"])

                if inv_status in ("paid", "partial"):
                    pct = Decimal("1.0") if inv_status == "paid" else Decimal("0.5")
                    paid_amt = (inv.total_ttc * pct).quantize(Decimal("1"))
                    InvoicePayment.objects.create(
                        invoice=inv,
                        amount=paid_amt,
                        method="virement",
                        recorded_by=manager,
                        date=inv_date + timedelta(days=15),
                    )

                InvoiceCounter.objects.get_or_create(
                    tenant=tenant, prefix="FA", year=today.year,
                    defaults={"last_sequence": i + 1},
                )
            created_invoices.append(inv)

        # Delivery Notes for first 2 invoices
        if len(created_invoices) >= 2:
            bl1, _ = DeliveryNote.objects.get_or_create(
                tenant=tenant,
                number="BL-2026-00001",
                defaults={
                    "client": created_invoices[0].client,
                    "invoice": created_invoices[0],
                    "date": today - timedelta(days=2),
                    "delivered_by": "Transport Express Alger",
                    "notes": "Livraison conforme en 4 cartons cerclés.",
                },
            )
            if bl1.lines.count() == 0 and all_variants:
                DeliveryNoteLine.objects.create(
                    delivery_note=bl1,
                    variant=all_variants[0],
                    description=f"{all_variants[0].product.name} EU{all_variants[0].size_eu}",
                    quantity=Decimal("24.00"),
                    cartons=2,
                    order=0,
                )

            bl2, _ = DeliveryNote.objects.get_or_create(
                tenant=tenant,
                number="BL-2026-00002",
                defaults={
                    "client": created_invoices[1].client,
                    "invoice": created_invoices[1],
                    "date": today - timedelta(days=1),
                    "delivered_by": "Chauffeur Interne",
                    "notes": "Livraison boutique Didouche.",
                },
            )
            if bl2.lines.count() == 0 and len(all_variants) > 1:
                DeliveryNoteLine.objects.create(
                    delivery_note=bl2,
                    variant=all_variants[1],
                    description=f"{all_variants[1].product.name} EU{all_variants[1].size_eu}",
                    quantity=Decimal("36.00"),
                    cartons=3,
                    order=0,
                )

        self.stdout.write(f"  ✓ Invoices: {len(created_invoices)} invoices + 2 Delivery Notes (BL) with cartons")

        # ── 13. Generate Import Fixtures ────────────────────────────────────────
        from apps.core.services.demo_fixtures_generator import generate_demo_fixtures

        fixture_dir = generate_demo_fixtures()
        self.stdout.write(f"  ✓ Demo Import Fixtures generated in: {fixture_dir}")

        self.stdout.write(self.style.SUCCESS("\n✅ Complete demo dataset & fixtures seeded successfully!\n"))
        self.stdout.write("   Credentials:")
        self.stdout.write("   • Admin/Owner:   0555 00 00 01 / admin@demo.com   |  password: demo1234")
        self.stdout.write("   • Manager:       0555 00 00 02 / manager@demo.com |  password: demo1234")
        self.stdout.write("   • Cashier:       0555 00 00 03 / cashier@demo.com |  password: demo1234\n")
        self.stdout.write("   Sample Files for Imports:")
        self.stdout.write(f"   • Legacy DBF:      {fixture_dir}/legacy_dbf/")
        self.stdout.write(f"   • Purchase Orders: {fixture_dir}/purchase_orders/")
        self.stdout.write(f"   • Products:        {fixture_dir}/products/\n")
