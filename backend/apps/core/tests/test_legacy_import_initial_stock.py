"""
The legacy DBF import keeps exactly one INITIAL stock movement per variant, even when the store already
holds several for it or the old database lists the same article twice.

Context: a store's import failed twice (500) with
`ValueError: StockMovement object can't be deleted because its id attribute is set to None` in
`record_initial_stock`. The surplus movements were deleted but stayed in the importer's cache, so the
next row for the same variant tried to delete them again.

Synthetic data only: the DBF files are replaced by in-memory records.
"""
from decimal import Decimal

import pytest

from apps.core.models import Branch, Tenant
from apps.core.services.legacy_dbf import LegacyDBFImporter
from apps.inventory.models import MovementReasonChoices, Product, StockMovement, Variant


@pytest.fixture
def tenant(db):
    return Tenant.objects.create(name="Legacy Stock Store", is_active=True)


@pytest.fixture
def branch(tenant):
    return Branch.objects.create(tenant=tenant, name="Alger Centre", is_headquarters=True)


def _article(ref, stock, pointure=""):
    return {
        "ARTICLE": f"A-{ref}", "REFERENCE": ref, "LIBELLE": f"Modele {ref}", "FAMILLE": "",
        "PRIX_ACHAT": Decimal("2000"), "BTARIF1": Decimal("4000"), "ST_BL": stock, "POINTURE": pointure,
    }


@pytest.fixture
def run_import(tenant, branch, monkeypatch):
    def run(articles, **options):
        def fake_get_dbf(self, filename, optional=False):
            return articles if filename == "ARTICLEB.DBF" else []

        monkeypatch.setattr(LegacyDBFImporter, "get_dbf", fake_get_dbf)
        importer = LegacyDBFImporter(
            path="/unused", tenant=tenant, branch=branch,
            options={"suppliers": False, "clients": False, "products": True, "cheques": False,
                     "part_payments": False, "purchases": False, "defects": False, "sales": False, **options},
        )
        return importer.execute_import()

    return run


def _initial(tenant, variant):
    return StockMovement.objects.filter(tenant=tenant, variant=variant, reason=MovementReasonChoices.INITIAL)


def _variant(tenant, ref, size=0):
    return Variant.objects.get(tenant=tenant, product__reference=ref, size_eu=size)


def _existing_variant_with_initial_movements(tenant, branch, ref, quantities, size=0):
    product = Product.objects.create(tenant=tenant, reference=ref, name=ref, sale_price=Decimal("4000"),
                                     purchase_price=Decimal("2000"))
    variant = Variant.objects.create(tenant=tenant, product=product, size_eu=size, colour="Standard")
    for qty in quantities:
        StockMovement.objects.create(tenant=tenant, branch=branch, variant=variant, quantity_delta=qty,
                                     reason=MovementReasonChoices.INITIAL, notes="earlier import")
    return variant


@pytest.mark.django_db
class TestInitialStockMovements:
    def test_duplicate_rows_for_a_variant_with_surplus_movements_do_not_crash(self, tenant, branch, run_import):
        """The reported crash: 2 stored movements + the same reference listed twice."""
        variant = _existing_variant_with_initial_movements(tenant, branch, "REF1", [3, 4])
        stats = run_import([_article("REF1", 5), _article("REF1", 7)])

        assert stats["products_imported"] == 2
        movements = list(_initial(tenant, variant))
        assert len(movements) == 1 and movements[0].quantity_delta == 7          # the last row wins, as for a single movement
        variant.refresh_from_db()
        assert variant.stock_qty == 7

    def test_surplus_movements_are_removed_on_a_single_visit(self, tenant, branch, run_import):
        variant = _existing_variant_with_initial_movements(tenant, branch, "REF2", [3, 4, 9])
        run_import([_article("REF2", 6)])

        assert [m.quantity_delta for m in _initial(tenant, variant)] == [6]
        variant.refresh_from_db()
        assert variant.stock_qty == 6

    def test_the_same_reference_twice_in_a_first_import(self, tenant, run_import):
        run_import([_article("REF3", 5), _article("REF3", 7)])

        variant = _variant(tenant, "REF3")
        assert [m.quantity_delta for m in _initial(tenant, variant)] == [7]
        variant.refresh_from_db()
        assert variant.stock_qty == 7
        assert Product.objects.filter(tenant=tenant, reference="REF3").count() == 1

    def test_running_the_same_import_again_changes_nothing(self, tenant, branch, run_import):
        articles = [_article("REF4", 5), _article("REF5", 8)]
        run_import(articles)
        before = list(StockMovement.objects.filter(tenant=tenant).order_by("pk").values_list("pk", "quantity_delta"))
        run_import(articles)
        after = list(StockMovement.objects.filter(tenant=tenant).order_by("pk").values_list("pk", "quantity_delta"))
        assert after == before

    def test_every_size_of_a_matrix_import_ends_with_one_movement(self, tenant, branch, run_import):
        """Same crash in matrix mode (one variant per size)."""
        variants = []
        product = Product.objects.create(tenant=tenant, reference="REF6", name="REF6", sale_price=Decimal("4000"),
                                         purchase_price=Decimal("2000"))
        for size in (40, 41, 42):
            variant = Variant.objects.create(tenant=tenant, product=product, size_eu=size, colour="Standard")
            variants.append(variant)
            for qty in (2, 3):
                StockMovement.objects.create(tenant=tenant, branch=branch, variant=variant, quantity_delta=qty,
                                             reason=MovementReasonChoices.INITIAL, notes="earlier import")

        run_import([_article("REF6", 6, "40-42"), _article("REF6", 9, "40-42")], easy_mode=False)

        for variant in variants:
            assert _initial(tenant, variant).count() == 1
            variant.refresh_from_db()
        assert sum(v.stock_qty for v in variants) == 9
