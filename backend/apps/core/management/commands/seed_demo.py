"""
Management command: python manage.py seed_demo

Creates a complete demo dataset for development and testing:
  - 1 Tenant: "Demo Store"
  - 3 Users: Owner, Manager, Cashier
  - 2 Branches: Alger Centre, Bab Ezzouar
  - 20 Products with full variant matrices
  - 5 Clients with ledger history
  - 3 Pending cheques
  - 30 Sales over the last 30 days
  - 10 Invoices in various statuses
"""
import random
from datetime import date, timedelta
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone


BRANDS = ["Nike", "Adidas", "Puma", "Reebok", "New Balance", "Skechers", "Vans", "Converse"]
COLOURS = ["Noir", "Blanc", "Rouge", "Bleu", "Marron", "Gris", "Beige", "Vert"]
CATEGORIES = ["sneakers", "boots", "sandals", "formal", "sport"]
PRODUCT_NAMES = [
    "Air Max", "Ultra Boost", "Classic Leather", "Chuck Taylor", "Old Skool",
    "Stan Smith", "Forum Low", "Suede Classic", "Cortez", "Blazer Mid",
    "574", "990v5", "Club C", "Classic", "Gel-Nimbus",
    "GTS 2000", "Fresh Foam", "Superstar", "Gazelle", "Handball Spezial",
]

CLIENT_NAMES = [
    ("Boutique El Amine", "05 55 11 22 33", "16"),
    ("Chaussures Modernes", "05 55 44 55 66", "31"),
    ("Mode & Style", "05 55 77 88 99", "25"),
    ("Maison du Sport", "05 55 00 11 22", "09"),
    ("Tendances Footwear", "05 55 33 44 55", "06"),
]


class Command(BaseCommand):
    help = "Seed the database with demo data for development."

    def add_arguments(self, parser):
        parser.add_argument("--reset", action="store_true", help="Delete existing demo data first.")

    @transaction.atomic
    def handle(self, *args, **options):
        self.stdout.write(self.style.MIGRATE_HEADING("🌱 Seeding demo data..."))

        from apps.core.models import Branch, PlanChoices, RoleChoices, Tenant, User

        # ── Tenant ──────────────────────────────────────────────────────────────
        tenant, created = Tenant.objects.get_or_create(
            name="ShoeDZ Demo Store",
            defaults={
                "plan": PlanChoices.PRO_WHOLESALE,
                "nif": "123456789012345",
                "rc": "16/00-1234567 B 20",
                "ai": "16234567890",
                "phone": "023 00 00 00",
                "address": "12 Rue de la Paix, Alger",
                "wilaya": "16",
            },
        )
        self.stdout.write(f"  ✓ Tenant: {tenant.name}")

        # ── Users ────────────────────────────────────────────────────────────────
        owner, _ = User.objects.get_or_create(
            email="admin@demo.com",
            defaults={
                "tenant": tenant,
                "role": RoleChoices.OWNER,
                "first_name": "Admin",
                "last_name": "Owner",
                "is_staff": True,
            },
        )
        owner.set_password("demo1234")
        owner.save()

        manager, _ = User.objects.get_or_create(
            email="manager@demo.com",
            defaults={
                "tenant": tenant,
                "role": RoleChoices.MANAGER,
                "first_name": "Karim",
                "last_name": "Manager",
            },
        )
        manager.set_password("demo1234")
        manager.save()

        cashier, _ = User.objects.get_or_create(
            email="cashier@demo.com",
            defaults={
                "tenant": tenant,
                "role": RoleChoices.CASHIER,
                "first_name": "Yacine",
                "last_name": "Cashier",
            },
        )
        cashier.set_password("demo1234")
        cashier.save()
        self.stdout.write("  ✓ Users: admin@demo.com / manager@demo.com / cashier@demo.com (password: demo1234)")

        # ── Branches ─────────────────────────────────────────────────────────────
        branch1, _ = Branch.objects.get_or_create(
            tenant=tenant, name="Alger Centre",
            defaults={"address": "Rue Didouche Mourad, Alger", "wilaya": "16", "is_headquarters": True}
        )
        branch2, _ = Branch.objects.get_or_create(
            tenant=tenant, name="Bab Ezzouar",
            defaults={"address": "Centre Commercial Bab Ezzouar", "wilaya": "16"}
        )
        branches = [branch1, branch2]
        self.stdout.write("  ✓ Branches: Alger Centre, Bab Ezzouar")

        # ── Products ─────────────────────────────────────────────────────────────
        from apps.inventory.models import Product, Variant, StockMovement, MovementReasonChoices

        products = []
        for i, name in enumerate(PRODUCT_NAMES):
            brand = BRANDS[i % len(BRANDS)]
            category = CATEGORIES[i % len(CATEGORIES)]
            purchase = Decimal(str(random.randint(2000, 8000)))
            sale = purchase * Decimal(str(round(random.uniform(1.4, 2.2), 1)))
            p, _ = Product.objects.get_or_create(
                tenant=tenant,
                name=name,
                brand=brand,
                defaults={
                    "category": category,
                    "gender": random.choice(["M", "F", "K", "U"]),
                    "purchase_price": purchase.quantize(Decimal("1")),
                    "sale_price": sale.quantize(Decimal("1")),
                },
            )
            products.append(p)

            # Create variants: sizes 38-43, 3 colours
            sizes = random.sample(range(38, 44), 4)
            colours = random.sample(COLOURS, 3)
            for size in sizes:
                for colour in colours:
                    v, v_created = Variant.objects.get_or_create(
                        tenant=tenant, product=p, size_eu=size, colour=colour,
                        defaults={"alert_threshold": 3},
                    )
                    if v_created:
                        # Initial stock
                        qty = random.randint(5, 30)
                        StockMovement.objects.create(
                            tenant=tenant,
                            variant=v,
                            branch=branch1,
                            quantity_delta=qty,
                            reason=MovementReasonChoices.INITIAL,
                            user=owner,
                        )

        self.stdout.write(f"  ✓ Products: {len(products)} articles with variants")

        # ── Clients ──────────────────────────────────────────────────────────────
        from apps.clients.models import Client, ClientLedger, Cheque

        clients = []
        for name, phone, wilaya in CLIENT_NAMES:
            c, _ = Client.objects.get_or_create(
                tenant=tenant, name=name,
                defaults={
                    "phone": phone, "wilaya": wilaya,
                    "credit_limit": Decimal(str(random.randint(50000, 500000))),
                    "nif": f"00{random.randint(10000000, 99999999)}0001",
                },
            )
            clients.append(c)
        self.stdout.write(f"  ✓ Clients: {len(clients)}")

        # ── Cheques ──────────────────────────────────────────────────────────────
        today = timezone.now().date()
        cheque_dates = [today + timedelta(days=2), today + timedelta(days=5), today + timedelta(days=12)]
        for i, due_date in enumerate(cheque_dates):
            Cheque.objects.get_or_create(
                tenant=tenant,
                number=f"CH-2026-{i+1:03d}",
                defaults={
                    "client": clients[i],
                    "direction": "receivable",
                    "bank": "BNA",
                    "amount": Decimal(str(random.randint(50000, 200000))),
                    "due_date": due_date,
                },
            )
        self.stdout.write("  ✓ Cheques: 3 pending")

        # ── Sales ────────────────────────────────────────────────────────────────
        from apps.sales.models import Payment, Sale, SaleItem

        all_variants = list(Variant.objects.filter(tenant=tenant, stock_qty__gt=0)[:50])
        sale_count = 0
        for day_offset in range(30):
            sale_date = timezone.now() - timedelta(days=day_offset)
            num_sales = random.randint(1, 4)
            for _ in range(num_sales):
                if not all_variants:
                    break
                branch = random.choice(branches)
                variant = random.choice(all_variants)

                total = variant.product.sale_price * random.randint(1, 3)

                import datetime
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
                # Update stock
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

        # ── Invoices ─────────────────────────────────────────────────────────────
        from apps.invoicing.models import Invoice, InvoiceCounter, InvoiceLine, InvoicePayment

        statuses = ["paid", "paid", "partial", "sent", "overdue", "draft", "sent", "partial", "paid", "overdue"]
        for i, inv_status in enumerate(statuses):
            client = clients[i % len(clients)]
            inv_date = today - timedelta(days=i * 7)
            due = inv_date + timedelta(days=30)

            inv, created = Invoice.objects.get_or_create(
                tenant=tenant,
                number=f"FA-2026-{i+1:05d}",
                defaults={
                    "client": client,
                    "branch": branch1,
                    "series_prefix": "FA",
                    "date": inv_date,
                    "due_date": due,
                    "status": inv_status,
                    "apply_tva": True,
                    "tva_rate": Decimal("19.00"),
                    "created_by": manager,
                },
            )
            if created:
                # Add 3 lines
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

                # Add partial/full payments
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

                # Ensure counter is set
                InvoiceCounter.objects.get_or_create(
                    tenant=tenant, prefix="FA", year=today.year,
                    defaults={"last_sequence": i + 1},
                )

        self.stdout.write("  ✓ Invoices: 10 in various statuses")

        self.stdout.write(self.style.SUCCESS("\n✅ Demo data seeded successfully!\n"))
        self.stdout.write("   Login: admin@demo.com  |  password: demo1234")
        self.stdout.write("   Login: manager@demo.com  |  password: demo1234")
        self.stdout.write("   Login: cashier@demo.com  |  password: demo1234\n")
