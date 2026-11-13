"""Tests for Task 7.4: Demi-gros tier and per-client price tier."""
from decimal import Decimal
import pytest
from rest_framework import status
from rest_framework.test import APIClient

from apps.clients.models import Client, ClientTypeChoices, PriceTierChoices
from apps.core.models import Branch, RoleChoices, StoreSettings, Tenant, User
from apps.core.services.importer import DataImportEngine, auto_map_columns
from apps.inventory.models import MovementReasonChoices, Product, StockMovement, Variant
from apps.inventory.services.pricing import unit_price_for
from apps.sales.models import CashSession, HeldSale


@pytest.fixture
def setup_tier_env(db):
    tenant = Tenant.objects.create(name="Tier Pricing Footwear", is_active=True)
    branch = Branch.objects.create(tenant=tenant, name="Siège", is_headquarters=True)
    StoreSettings.objects.create(tenant=tenant)
    manager = User.objects.create_user(
        email="mgr_tier@shoedz.dz",
        phone="0550111222",
        password="securepassword123",
        role=RoleChoices.MANAGER,
        tenant=tenant,
    )
    manager.set_pin("4321")
    manager.save()

    cashier = User.objects.create_user(
        email="cashier_tier@shoedz.dz",
        phone="0550333444",
        password="securepassword123",
        role=RoleChoices.CASHIER,
        tenant=tenant,
        can_modify_price=False,
        max_discount_pct=10,
    )

    product = Product.objects.create(
        tenant=tenant,
        name="Air Force Tier",
        brand="Nike",
        reference="AF-TIER-01",
        purchase_price=Decimal("3500.00"),
        sale_price=Decimal("6500.00"),
        semi_wholesale_price=Decimal("5800.00"),
        wholesale_price=Decimal("5200.00"),
    )
    variant = Variant.objects.create(
        tenant=tenant,
        product=product,
        size_eu=42,
        colour="Blanc",
    )
    StockMovement.objects.create(
        tenant=tenant,
        branch=branch,
        variant=variant,
        quantity_delta=30,
        reason=MovementReasonChoices.INITIAL,
        user=manager,
    )
    variant.refresh_from_db()

    CashSession.objects.create(
        tenant=tenant,
        branch=branch,
        cashier=cashier,
        session_number=1,
        status="open",
        opening_float=Decimal("5000.00"),
    )

    client_detail = Client.objects.create(
        tenant=tenant,
        name="Client Détail",
        phone="0661000001",
        client_type=ClientTypeChoices.RETAIL,
        price_tier=PriceTierChoices.DETAIL,
    )
    client_demi = Client.objects.create(
        tenant=tenant,
        name="Client Demi-Gros",
        phone="0661000002",
        client_type=ClientTypeChoices.WHOLESALE,
        price_tier=PriceTierChoices.DEMI_GROS,
    )
    client_gros = Client.objects.create(
        tenant=tenant,
        name="Client Gros",
        phone="0661000003",
        client_type=ClientTypeChoices.WHOLESALE,
        price_tier=PriceTierChoices.GROS,
    )

    return {
        "tenant": tenant,
        "branch": branch,
        "manager": manager,
        "cashier": cashier,
        "product": product,
        "variant": variant,
        "client_detail": client_detail,
        "client_demi": client_demi,
        "client_gros": client_gros,
    }


@pytest.mark.django_db
class TestUnitPriceForService:
    def test_unit_price_follows_tier(self, setup_tier_env):
        variant = setup_tier_env["variant"]
        product = setup_tier_env["product"]

        assert unit_price_for(variant, "detail") == Decimal("6500.00")
        assert unit_price_for(variant, None) == Decimal("6500.00")
        assert unit_price_for(variant, "demi_gros") == Decimal("5800.00")
        assert unit_price_for(variant, "gros") == Decimal("5200.00")
        assert unit_price_for(product, "demi_gros") == Decimal("5800.00")

    def test_fallback_demi_gros_to_gros_to_detail(self, setup_tier_env):
        tenant = setup_tier_env["tenant"]

        # Product with no semi_wholesale_price falls back to wholesale_price
        p_no_demi = Product.objects.create(
            tenant=tenant,
            name="Modèle Sans Demi-Gros",
            sale_price=Decimal("7000.00"),
            semi_wholesale_price=None,
            wholesale_price=Decimal("5500.00"),
        )
        assert unit_price_for(p_no_demi, "demi_gros") == Decimal("5500.00")

        # Product with neither semi_wholesale_price nor wholesale_price falls back to sale_price
        p_only_detail = Product.objects.create(
            tenant=tenant,
            name="Modèle Détail Uniquement",
            sale_price=Decimal("7000.00"),
            semi_wholesale_price=None,
            wholesale_price=Decimal("0.00"),
        )
        assert unit_price_for(p_only_detail, "demi_gros") == Decimal("7000.00")
        assert unit_price_for(p_only_detail, "gros") == Decimal("7000.00")


@pytest.mark.django_db
class TestCashierTierPriceValidation:
    def test_cashier_can_sell_at_client_tier_price_without_pin(self, setup_tier_env):
        cashier = setup_tier_env["cashier"]
        variant = setup_tier_env["variant"]
        branch = setup_tier_env["branch"]
        client_demi = setup_tier_env["client_demi"]
        client_gros = setup_tier_env["client_gros"]

        api = APIClient(HTTP_HOST="localhost")
        api.force_authenticate(user=cashier)

        # Selling to demi-gros client at demi-gros price (5800) succeeds without manager PIN
        res_demi = api.post(
            "/api/v1/sales/",
            {
                "branch_id": str(branch.id),
                "client_id": str(client_demi.id),
                "items": [
                    {
                        "variant_id": str(variant.id),
                        "quantity": 1,
                        "unit_price": "5800.00",
                        "discount_amount": "0.00",
                    }
                ],
                "payments": [{"method": "cash", "amount": "5800.00"}],
                "cart_discount": "0.00",
            },
            format="json",
        )
        assert res_demi.status_code == status.HTTP_201_CREATED

        # Selling to gros client at gros price (5200) succeeds without manager PIN
        res_gros = api.post(
            "/api/v1/sales/",
            {
                "branch_id": str(branch.id),
                "client_id": str(client_gros.id),
                "items": [
                    {
                        "variant_id": str(variant.id),
                        "quantity": 1,
                        "unit_price": "5200.00",
                        "discount_amount": "0.00",
                    }
                ],
                "payments": [{"method": "cash", "amount": "5200.00"}],
                "cart_discount": "0.00",
            },
            format="json",
        )
        assert res_gros.status_code == status.HTTP_201_CREATED

    def test_cashier_cannot_alter_client_tier_price_without_pin(self, setup_tier_env):
        cashier = setup_tier_env["cashier"]
        variant = setup_tier_env["variant"]
        branch = setup_tier_env["branch"]
        client_demi = setup_tier_env["client_demi"]

        api = APIClient(HTTP_HOST="localhost")
        api.force_authenticate(user=cashier)

        # Selling to demi-gros client at arbitrary price (5000 != 5800) is blocked without PIN
        res = api.post(
            "/api/v1/sales/",
            {
                "branch_id": str(branch.id),
                "client_id": str(client_demi.id),
                "items": [
                    {
                        "variant_id": str(variant.id),
                        "quantity": 1,
                        "unit_price": "5000.00",
                        "discount_amount": "0.00",
                    }
                ],
                "payments": [{"method": "cash", "amount": "5000.00"}],
                "cart_discount": "0.00",
            },
            format="json",
        )
        assert res.status_code == status.HTTP_400_BAD_REQUEST
        assert "5800.00 DA" in str(res.data)

    def test_held_sale_resume_uses_client_tier_price(self, setup_tier_env):
        tenant = setup_tier_env["tenant"]
        branch = setup_tier_env["branch"]
        cashier = setup_tier_env["cashier"]
        variant = setup_tier_env["variant"]
        client_demi = setup_tier_env["client_demi"]

        held = HeldSale.objects.create(
            tenant=tenant,
            branch=branch,
            cashier=cashier,
            client=client_demi,
            label="Panier Demi-Gros",
            cart=[
                {
                    "variant_id": str(variant.id),
                    "quantity": 2,
                    "unit_price": "5800.00",
                    "discount_amount": "0.00",
                }
            ],
            cart_discount=Decimal("0.00"),
        )

        api = APIClient(HTTP_HOST="localhost")
        api.force_authenticate(user=cashier)

        res = api.post(f"/api/v1/sales/held/{held.id}/resume/")
        assert res.status_code == status.HTTP_200_OK
        assert res.data["changes"] == []
        assert res.data["cart"][0]["unit_price"] == "5800.00"


@pytest.mark.django_db
class TestBulkImportDemiGrosAndTier:
    def test_bulk_import_maps_and_persists_demi_gros_and_price_tier(self, setup_tier_env):
        tenant = setup_tier_env["tenant"]
        branch = setup_tier_env["branch"]
        manager = setup_tier_env["manager"]

        prod_headers = ["Nom", "Marque", "Pointure", "Prix Vente", "Prix Demi-Gros", "Prix Gros"]
        prod_map = auto_map_columns(prod_headers, "products")
        assert prod_map["Prix Demi-Gros"] == "semi_wholesale_price"
        assert prod_map["Prix Gros"] == "wholesale_price"

        engine = DataImportEngine(tenant=tenant, entity_type="products", user=manager, branch=branch)
        rows = [
            {
                "Nom": "Mocassin Pro",
                "Marque": "Clarks",
                "Pointure": "41",
                "Prix Vente": "8000",
                "Prix Demi-Gros": "7200",
                "Prix Gros": "6400",
            }
        ]
        res = engine.execute_import(rows, prod_map)
        assert res["created_products"] == 1
        p = Product.objects.get(tenant=tenant, name="Mocassin Pro")
        assert p.semi_wholesale_price == Decimal("7200.00")
        assert p.wholesale_price == Decimal("6400.00")

        client_headers = ["Nom du Client", "Téléphone", "Grille tarifaire"]
        client_map = auto_map_columns(client_headers, "clients")
        assert client_map["Grille tarifaire"] == "price_tier"

        c_engine = DataImportEngine(tenant=tenant, entity_type="clients", user=manager, branch=branch)
        c_rows = [
            {"Nom du Client": "Boutique Demi", "Téléphone": "0550998877", "Grille tarifaire": "demi-gros"}
        ]
        c_res = c_engine.execute_import(c_rows, client_map)
        assert c_res["created"] == 1
        c = Client.objects.get(tenant=tenant, name="Boutique Demi")
        assert c.price_tier == PriceTierChoices.DEMI_GROS
        assert c.client_type == ClientTypeChoices.WHOLESALE


@pytest.mark.django_db
class TestExpandCartonsPricingTiers:
    def test_expand_cartons_respects_tier(self, setup_tier_env):
        manager = setup_tier_env["manager"]
        product = setup_tier_env["product"]
        # product: sale_price=6500, semi_wholesale_price=5800, wholesale_price=5200
        product.carton_breakdown = {"42": 10}
        product.pairs_per_carton = 10
        product.save()

        api = APIClient(HTTP_HOST="localhost")
        api.force_authenticate(user=manager)

        # Default tier without param defaults to "gros" (wholesale_price = 5200)
        res_default = api.post(
            f"/api/v1/inventory/products/{product.id}/expand-cartons/",
            {"cartons": 1, "colour": "Blanc"},
            format="json",
        )
        assert res_default.status_code == 200
        assert res_default.data["lines"][0]["unit_price"] == "5200.00"

        # Explicit demi_gros tier uses semi_wholesale_price = 5800
        res_demi = api.post(
            f"/api/v1/inventory/products/{product.id}/expand-cartons/",
            {"cartons": 1, "colour": "Blanc", "tier": "demi_gros"},
            format="json",
        )
        assert res_demi.status_code == 200
        assert res_demi.data["lines"][0]["unit_price"] == "5800.00"

        # Explicit detail tier uses sale_price = 6500
        res_detail = api.post(
            f"/api/v1/inventory/products/{product.id}/expand-cartons/",
            {"cartons": 1, "colour": "Blanc", "tier": "detail"},
            format="json",
        )
        assert res_detail.status_code == 200
        assert res_detail.data["lines"][0]["unit_price"] == "6500.00"

