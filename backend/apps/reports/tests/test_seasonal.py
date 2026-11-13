"""Aïd windows and year-over-year comparison."""
from datetime import date, datetime, timedelta
from decimal import Decimal

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.reports.services.seasonal import next_aid_preview, seasonal_comparison, window_for


def _at(day: date):
    return timezone.make_aware(datetime(day.year, day.month, day.day, 12, 0))


def test_window_is_the_days_before_the_event():
    start, end = window_for(date(2026, 3, 20), 30)
    assert start == date(2026, 2, 18)
    assert end == date(2026, 3, 19)


@pytest.mark.django_db
class TestSeasonalComparison:
    @pytest.fixture(autouse=True)
    def setup(self, db):
        from apps.core.models import PlanChoices, RoleChoices, Tenant, User
        self.tenant = Tenant.objects.create(name="Aïd Shop", plan=PlanChoices.PRO_RETAIL)
        self.owner = User.objects.create_user(
            email="owner@aid.com", password="testpass123",
            tenant=self.tenant, role=RoleChoices.OWNER,
        )
        self.manager = User.objects.create_user(
            email="mgr@aid.com", password="testpass123",
            tenant=self.tenant, role=RoleChoices.MANAGER,
        )
        self.cashier = User.objects.create_user(
            email="cash@aid.com", password="testpass123",
            tenant=self.tenant, role=RoleChoices.CASHIER,
        )

    def _variant(self):
        from apps.inventory.models import Product, Variant
        product = Product.objects.create(
            tenant=self.tenant, name="City", brand="Atlas",
            sale_price=Decimal("4000.00"), purchase_price=Decimal("2000.00"),
        )
        return Variant.objects.create(
            tenant=self.tenant, product=product, size_eu=42, colour="Noir",
        )

    def _sell(self, variant, qty, day, total):
        from apps.sales.models import Sale, SaleItem
        sale = Sale.objects.create(
            tenant=self.tenant, cashier=self.manager, status="completed",
            total_amount=Decimal(total),
            receipt_number=f"RC-{day.isoformat()}-{qty}",
        )
        Sale.objects.filter(pk=sale.pk).update(created_at=_at(day))
        SaleItem.objects.create(
            sale=sale, variant=variant, quantity=qty, unit_price=Decimal("4000.00"),
        )

    def test_seed_uses_umm_al_qura_and_keeps_an_edited_date(self):
        from apps.reports.models import SeasonalEvent
        from apps.reports.services.seasonal import ensure_seasonal_events
        ensure_seasonal_events(self.tenant)
        fitr = SeasonalEvent.objects.get(tenant=self.tenant, seed_key="aid_el_fitr:1441")
        assert fitr.date == date(2020, 5, 24)
        assert fitr.is_estimated is True
        rentree = SeasonalEvent.objects.get(tenant=self.tenant, seed_key="rentree:2026")
        assert rentree.date == date(2026, 9, 1)

        fitr.date = date(2020, 5, 25)
        fitr.is_estimated = False
        fitr.save()
        ensure_seasonal_events(self.tenant)
        fitr.refresh_from_db()
        assert fitr.date == date(2020, 5, 25)
        assert SeasonalEvent.objects.filter(tenant=self.tenant, seed_key="aid_el_fitr:1441").count() == 1

    def test_comparison_counts_only_the_window_for_each_year(self):
        from apps.reports.models import SeasonalEvent
        from apps.reports.services.seasonal import ensure_seasonal_events
        ensure_seasonal_events(self.tenant)
        variant = self._variant()
        first = SeasonalEvent.objects.get(tenant=self.tenant, seed_key="aid_el_fitr:1446")
        second = SeasonalEvent.objects.get(tenant=self.tenant, seed_key="aid_el_fitr:1447")
        self._sell(variant, 2, first.date - timedelta(days=10), "3000.00")
        self._sell(variant, 4, second.date - timedelta(days=10), "8000.00")
        self._sell(variant, 9, second.date, "9000.00")
        self._sell(variant, 8, second.date - timedelta(days=40), "1000.00")

        report = seasonal_comparison(
            self.tenant, kind="aid_el_fitr", days_before=30, today=date(2026, 11, 13),
        )
        by_date = {row["date"]: row for row in report["occurrences"]}
        assert by_date[first.date.isoformat()]["pairs"] == 2
        assert by_date[first.date.isoformat()]["revenue"] == "3000.00"
        assert by_date[first.date.isoformat()]["top_models"][0]["name"] == "Atlas City"
        assert by_date[first.date.isoformat()]["top_sizes"][0] == {"size_eu": 42, "pairs": 2}
        assert by_date[second.date.isoformat()]["pairs"] == 4
        assert by_date[second.date.isoformat()]["revenue"] == "8000.00"

    def test_preview_uses_the_previous_occurrence(self):
        from apps.reports.models import SeasonalEvent
        from apps.reports.services.seasonal import ensure_seasonal_events
        ensure_seasonal_events(self.tenant)
        upcoming = SeasonalEvent.objects.get(tenant=self.tenant, seed_key="aid_el_fitr:1446")
        previous = SeasonalEvent.objects.get(tenant=self.tenant, seed_key="aid_el_fitr:1445")
        variant = self._variant()
        self._sell(variant, 7, previous.date - timedelta(days=5), "7000.00")
        preview = next_aid_preview(self.tenant, today=upcoming.date - timedelta(days=23))
        assert preview["days_until"] == 23
        assert preview["date"] == upcoming.date.isoformat()
        assert preview["last_year_pairs"] == 7
        assert preview["last_year_top_sizes"] == [42]

    def test_owner_can_confirm_a_date_and_cashier_cannot_read(self):
        from apps.reports.models import SeasonalEvent
        from apps.reports.services.seasonal import ensure_seasonal_events
        ensure_seasonal_events(self.tenant)
        event = SeasonalEvent.objects.get(tenant=self.tenant, seed_key="rentree:2026")
        owner = APIClient()
        owner.force_authenticate(self.owner)
        updated = owner.patch(
            f"/api/v1/reports/seasonal-events/{event.pk}/",
            {"date": "2026-09-06"},
            format="json",
        )
        assert updated.status_code == 200, updated.data
        assert updated.data["date"] == "2026-09-06"
        assert updated.data["is_estimated"] is False

        manager = APIClient()
        manager.force_authenticate(self.manager)
        assert manager.patch(
            f"/api/v1/reports/seasonal-events/{event.pk}/",
            {"date": "2026-09-07"},
            format="json",
        ).status_code == 403
        listed = manager.get("/api/v1/reports/seasonal/?event=aid_el_fitr&days_before=30")
        assert listed.status_code == 200, listed.data
        assert listed.data["event"] == "aid_el_fitr"

        cashier = APIClient()
        cashier.force_authenticate(self.cashier)
        assert cashier.get("/api/v1/reports/seasonal/?event=aid_el_fitr").status_code == 403
        assert cashier.delete(f"/api/v1/reports/seasonal-events/{event.pk}/").status_code == 403

        refused = owner.delete(f"/api/v1/reports/seasonal-events/{event.pk}/")
        assert refused.status_code == 400
        assert SeasonalEvent.objects.filter(pk=event.pk).exists()
