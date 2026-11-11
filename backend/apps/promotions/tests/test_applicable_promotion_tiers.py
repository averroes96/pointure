from decimal import Decimal
import pytest
from rest_framework.test import APIClient
from django.utils import timezone

from apps.core.models import Tenant, User, RoleChoices
from apps.inventory.models import Product, Variant
from apps.promotions.models import Promotion


@pytest.fixture
def setup_promo_env(db):
    tenant = Tenant.objects.create(name="Promo Store")
    manager = User.objects.create_user(
        email="mgr_promo@test.com", password="password123",
        role=RoleChoices.MANAGER, tenant=tenant
    )
    product = Product.objects.create(
        tenant=tenant,
        name="Sneaker Promo Test",
        sale_price=Decimal("1000.00"),
        semi_wholesale_price=Decimal("900.00"),
        wholesale_price=Decimal("800.00"),
    )
    variant = Variant.objects.create(
        tenant=tenant,
        product=product,
        size_eu=42,
        colour="Noir",
    )
    # 10% discount promo
    promo = Promotion.objects.create(
        tenant=tenant,
        name="10% Off All",
        discount_pct=Decimal("10.00"),
        start_date=timezone.now().date(),
        is_active=True,
    )
    return {
        "tenant": tenant,
        "manager": manager,
        "product": product,
        "variant": variant,
        "promo": promo,
    }


@pytest.mark.django_db
def test_applicable_promotion_calculates_discount_on_tier_price(setup_promo_env):
    manager = setup_promo_env["manager"]
    variant = setup_promo_env["variant"]

    api = APIClient(HTTP_HOST="localhost")
    api.force_authenticate(user=manager)

    # 1. Retail / detail tier (default): 10% on 1000.00 = 100.00
    res_detail = api.get(f"/api/v1/promotions/applicable/?variant={variant.id}&qty=1")
    assert res_detail.status_code == 200
    assert Decimal(res_detail.data["computed_discount"]) == Decimal("100.00")

    # 2. Wholesale / gros tier: 10% on 800.00 = 80.00 (NOT 100.00)
    res_gros = api.get(f"/api/v1/promotions/applicable/?variant={variant.id}&qty=1&tier=gros")
    assert res_gros.status_code == 200
    assert Decimal(res_gros.data["computed_discount"]) == Decimal("80.00")

    # 3. Semi-wholesale / demi_gros tier: 10% on 900.00 = 90.00
    res_demi = api.get(f"/api/v1/promotions/applicable/?variant={variant.id}&qty=1&tier=demi_gros")
    assert res_demi.status_code == 200
    assert Decimal(res_demi.data["computed_discount"]) == Decimal("90.00")

