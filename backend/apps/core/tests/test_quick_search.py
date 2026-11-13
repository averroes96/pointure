"""
Unit and integration tests for Quick Search Engine (GET /api/v1/core/quick-search/).

Tests:
1. Returns products matching query (with location and total stock).
2. Returns clients matching query.
3. Returns invoices matching query.
4. Returns suppliers matching query for owner/manager, but omits suppliers for cashier.
5. Strict tenant isolation: never leaks records from another tenant.
6. Short queries (< 2 chars) return empty arrays.
"""
from decimal import Decimal
import pytest
from rest_framework import status
from rest_framework.test import APIClient

from django.utils import timezone
from apps.clients.models import Client
from apps.core.models import Branch, PlanChoices, RoleChoices, Tenant, User
from apps.inventory.models import Product, ProductLocation, Variant
from apps.invoicing.models import Invoice
from apps.suppliers.models import Supplier


@pytest.mark.django_db
class TestQuickSearch:
    @pytest.fixture(autouse=True)
    def setup_data(self):
        # Tenant 1 (Our Shop)
        self.tenant1 = Tenant.objects.create(name="Alger Centre Chaussures", plan=PlanChoices.PRO_WHOLESALE)
        self.branch1 = Branch.objects.create(tenant=self.tenant1, name="Boutique Principale")
        self.owner = User.objects.create_user(
            phone="0555111222",
            password="testpassword",
            tenant=self.tenant1,
            role=RoleChoices.OWNER,
        )
        self.cashier = User.objects.create_user(
            phone="0555333444",
            password="testpassword",
            tenant=self.tenant1,
            role=RoleChoices.CASHIER,
        )

        # Tenant 2 (Isolation Check)
        self.tenant2 = Tenant.objects.create(name="Oran Shoes", plan=PlanChoices.PRO_WHOLESALE)
        self.other_product = Product.objects.create(
            tenant=self.tenant2,
            name="Mocassin Cuir Secret Oran",
            reference="MOC-SECRET",
            sale_price=Decimal("4000.00"),
        )

        # Products in Tenant 1
        self.product1 = Product.objects.create(
            tenant=self.tenant1,
            name="Mocassin Cuir Alger",
            reference="MOC-ALG-01",
            brand="Pointure Brand",
            sale_price=Decimal("4500.00"),
            size_range="39/44",
        )
        ProductLocation.objects.create(tenant=self.tenant1, branch=self.branch1, product=self.product1, location="R05")
        Variant.objects.create(tenant=self.tenant1, product=self.product1, size_eu=40, stock_qty=5)
        Variant.objects.create(tenant=self.tenant1, product=self.product1, size_eu=41, stock_qty=7)

        # Client in Tenant 1
        self.client1 = Client.objects.create(
            tenant=self.tenant1,
            name="Mourad Benali",
            phone="0550123456",
            wilaya="16",
            price_tier="gros",
        )

        # Supplier in Tenant 1
        self.supplier1 = Supplier.objects.create(
            tenant=self.tenant1,
            name="Fournisseur Cuir Blida",
            phone="0560987654",
        )

        # Invoice in Tenant 1
        self.invoice1 = Invoice.objects.create(
            tenant=self.tenant1,
            client=self.client1,
            number="FAC-2026-0001",
            date=timezone.localdate(),
            due_date=timezone.localdate() + timezone.timedelta(days=30),
            total_ttc=Decimal("45000.00"),
        )

        self.api_client = APIClient()

    def test_quick_search_products_and_location(self):
        """Quick search finds products with their formatted location and total stock."""
        self.api_client.force_authenticate(user=self.owner)
        res = self.api_client.get(
            f"/api/v1/core/quick-search/?q=Mocassin&branch_id={self.branch1.id}"
        )
        assert res.status_code == status.HTTP_200_OK

        prods = res.data["products"]
        assert len(prods) == 1
        assert prods[0]["name"] == "Mocassin Cuir Alger"
        assert prods[0]["reference"] == "MOC-ALG-01"
        assert prods[0]["location"] == "R05 (39/44)"
        assert prods[0]["stock_qty"] == 12  # 5 + 7

    def test_quick_search_location_is_scoped_to_selected_branch(self):
        other_branch = Branch.objects.create(
            tenant=self.tenant1,
            name="Boutique Secondaire",
        )
        ProductLocation.objects.create(
            tenant=self.tenant1,
            branch=other_branch,
            product=self.product1,
            location="R99",
        )
        self.api_client.force_authenticate(user=self.owner)

        res = self.api_client.get(
            f"/api/v1/core/quick-search/?q=Mocassin&branch_id={other_branch.id}"
        )

        assert res.status_code == status.HTTP_200_OK
        assert len(res.data["products"]) == 1
        assert res.data["products"][0]["location"] == "R99 (39/44)"

    def test_quick_search_excludes_inactive_products_clients_suppliers_and_variants(self):
        Product.objects.create(
            tenant=self.tenant1,
            name="Inactive Searchable Product",
            sale_price=Decimal("1000.00"),
            is_active=False,
        )
        inactive_variant = Variant.objects.create(
            tenant=self.tenant1,
            product=self.product1,
            size_eu=42,
            stock_qty=100,
            is_active=False,
        )
        Variant.objects.filter(pk=inactive_variant.pk).update(barcode="INACTIVE-SKU-777")
        Client.objects.create(
            tenant=self.tenant1,
            name="Inactive Searchable Client",
            is_active=False,
        )
        Supplier.objects.create(
            tenant=self.tenant1,
            name="Inactive Searchable Supplier",
            is_active=False,
        )
        self.api_client.force_authenticate(user=self.owner)

        res = self.api_client.get(
            "/api/v1/core/quick-search/?q=Inactive&branch_id=" + str(self.branch1.id)
        )
        assert res.status_code == status.HTTP_200_OK
        assert res.data["products"] == []
        assert res.data["clients"] == []
        assert res.data["suppliers"] == []

        inactive_barcode_search = self.api_client.get(
            "/api/v1/core/quick-search/?q=INACTIVE-SKU-777"
        )
        assert inactive_barcode_search.status_code == status.HTTP_200_OK
        assert inactive_barcode_search.data["products"] == []

        active_product_search = self.api_client.get(
            "/api/v1/core/quick-search/?q=Mocassin&branch_id=" + str(self.branch1.id)
        )
        assert active_product_search.data["products"][0]["stock_qty"] == 12

    def test_quick_search_tenant_isolation(self):
        """Quick search NEVER returns entities belonging to other tenants."""
        self.api_client.force_authenticate(user=self.owner)
        res = self.api_client.get("/api/v1/core/quick-search/?q=Secret")
        assert res.status_code == status.HTTP_200_OK
        assert len(res.data["products"]) == 0

    def test_quick_search_clients_and_invoices(self):
        """Quick search finds clients and invoices matching the search term."""
        self.api_client.force_authenticate(user=self.owner)
        res = self.api_client.get("/api/v1/core/quick-search/?q=Benali")
        assert res.status_code == status.HTTP_200_OK

        assert len(res.data["clients"]) == 1
        assert res.data["clients"][0]["name"] == "Mourad Benali"
        assert res.data["clients"][0]["price_tier"] == "gros"

        assert len(res.data["invoices"]) == 1
        assert res.data["invoices"][0]["number"] == "FAC-2026-0001"

    @pytest.mark.parametrize("plan", ["free", "pro_retail"])
    def test_quick_search_hides_invoices_below_pro_wholesale(self, plan):
        self.tenant1.plan = plan
        self.tenant1.save(update_fields=["plan"])
        self.api_client.force_authenticate(user=self.owner)

        res = self.api_client.get("/api/v1/core/quick-search/?q=Benali")

        assert res.status_code == status.HTTP_200_OK
        assert res.data["clients"][0]["name"] == "Mourad Benali"
        assert res.data["invoices"] == []

    def test_enterprise_plan_can_search_invoices(self):
        self.tenant1.plan = "enterprise"
        self.tenant1.save(update_fields=["plan"])
        self.api_client.force_authenticate(user=self.owner)

        res = self.api_client.get("/api/v1/core/quick-search/?q=Benali")

        assert res.status_code == status.HTTP_200_OK
        assert [invoice["number"] for invoice in res.data["invoices"]] == ["FAC-2026-0001"]

    def test_cashier_can_search_products_clients_but_not_suppliers(self):
        """Cashiers can search products and clients, but supplier payables are withheld."""
        self.api_client.force_authenticate(user=self.cashier)
        res = self.api_client.get("/api/v1/core/quick-search/?q=Blida")
        assert res.status_code == status.HTTP_200_OK
        assert len(res.data["suppliers"]) == 0

        # Owner searching the same term gets the supplier
        self.api_client.force_authenticate(user=self.owner)
        res_owner = self.api_client.get("/api/v1/core/quick-search/?q=Blida")
        assert len(res_owner.data["suppliers"]) == 1
        assert res_owner.data["suppliers"][0]["name"] == "Fournisseur Cuir Blida"

    def test_short_query_returns_empty(self):
        """Queries shorter than 2 chars return empty results without hitting database."""
        self.api_client.force_authenticate(user=self.owner)
        res = self.api_client.get("/api/v1/core/quick-search/?q=a")
        assert res.status_code == status.HTTP_200_OK
        assert res.data == {"products": [], "clients": [], "suppliers": [], "invoices": []}
