from datetime import timedelta
from decimal import Decimal
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.core.models import Branch, RoleChoices, StoreSettings, Tenant, User
from apps.inventory.models import MovementReasonChoices, Product, StockMovement, Variant
from apps.sales.models import HeldSale, Sale
from apps.sales.tasks import cleanup_held_sales


class HeldSalesTests(TestCase):
    def setUp(self):
        self.tenant = Tenant.objects.create(name="Algerian Shoes Bab Ezzouar")
        self.branch1 = Branch.objects.create(tenant=self.tenant, name="Agence 1")
        self.branch2 = Branch.objects.create(tenant=self.tenant, name="Agence 2")

        self.settings = StoreSettings.objects.create(
            tenant=self.tenant,
            allow_negative_stock=False,
        )

        self.manager = User.objects.create_user(
            email="manager@pointure.dz",
            password="password123",
            role=RoleChoices.MANAGER,
            tenant=self.tenant,
        )

        self.cashier1 = User.objects.create_user(
            email="cashier1@pointure.dz",
            password="password123",
            role=RoleChoices.CASHIER,
            tenant=self.tenant,
        )

        self.cashier2 = User.objects.create_user(
            email="cashier2@pointure.dz",
            password="password123",
            role=RoleChoices.CASHIER,
            tenant=self.tenant,
        )

        self.product = Product.objects.create(
            tenant=self.tenant,
            name="Air Jordan 1",
            brand="Nike",
            reference="NK-AJ1-01",
            sale_price=Decimal("15000.00"),
            purchase_price=Decimal("10000.00"),
        )
        self.variant = Variant.objects.create(
            tenant=self.tenant,
            product=self.product,
            size_eu=42,
            colour="Rouge/Noir",
            stock_qty=10,
        )
        # Add branch stock movement for branch1
        StockMovement.objects.create(
            tenant=self.tenant,
            variant=self.variant,
            branch=self.branch1,
            reason=MovementReasonChoices.RECEPTION,
            quantity_delta=10,
        )

        self.client_api = APIClient()

    def tearDown(self):
        from apps.core.signals import set_current_user
        set_current_user(None)

    def test_create_held_sale_and_list_cashier_isolation(self):
        # Cashier 1 parks a sale
        self.client_api.force_authenticate(user=self.cashier1)
        resp1 = self.client_api.post(
            "/api/v1/sales/held/",
            {
                "branch": str(self.branch1.id),
                "label": "Client costume gris",
                "cart_discount": "500.00",
                "notes": "Client parti chercher sa monnaie",
                "cart": [
                    {
                        "variant_id": str(self.variant.id),
                        "quantity": 2,
                        "unit_price": "15000.00",
                        "discount_amount": "0.00",
                    }
                ],
            },
            format="json",
        )
        self.assertEqual(resp1.status_code, 201)
        held_id_1 = resp1.data["id"]
        self.assertEqual(resp1.data["cashier"], self.cashier1.id)
        self.assertEqual(resp1.data["item_count"], 2)
        # 2 * 15000 - 500 = 29500
        self.assertEqual(resp1.data["total_amount"], "29500.00")

        # Cashier 2 parks another sale
        self.client_api.force_authenticate(user=self.cashier2)
        resp2 = self.client_api.post(
            "/api/v1/sales/held/",
            {
                "branch": str(self.branch1.id),
                "label": "Dame robe rouge",
                "cart": [
                    {
                        "variant_id": str(self.variant.id),
                        "quantity": 1,
                        "unit_price": "15000.00",
                        "discount_amount": "0.00",
                    }
                ],
            },
            format="json",
        )
        self.assertEqual(resp2.status_code, 201)
        held_id_2 = resp2.data["id"]

        # Cashier 2 listing should only see held_id_2
        list_c2 = self.client_api.get("/api/v1/sales/held/")
        self.assertEqual(list_c2.status_code, 200)
        c2_ids = [item["id"] for item in list_c2.data["results"]]
        self.assertIn(held_id_2, c2_ids)
        self.assertNotIn(held_id_1, c2_ids)

        # Cashier 1 listing should only see held_id_1
        self.client_api.force_authenticate(user=self.cashier1)
        list_c1 = self.client_api.get("/api/v1/sales/held/")
        self.assertEqual(list_c1.status_code, 200)
        c1_ids = [item["id"] for item in list_c1.data["results"]]
        self.assertIn(held_id_1, c1_ids)
        self.assertNotIn(held_id_2, c1_ids)

        # Manager listing should see both
        self.client_api.force_authenticate(user=self.manager)
        list_mgr = self.client_api.get("/api/v1/sales/held/")
        self.assertEqual(list_mgr.status_code, 200)
        mgr_ids = [item["id"] for item in list_mgr.data["results"]]
        self.assertIn(held_id_1, mgr_ids)
        self.assertIn(held_id_2, mgr_ids)

    def test_held_sale_branch_limit_20(self):
        self.client_api.force_authenticate(user=self.cashier1)
        for i in range(20):
            HeldSale.objects.create(
                tenant=self.tenant,
                branch=self.branch1,
                cashier=self.cashier1,
                label=f"Parked sale {i+1}",
                cart=[{"variant_id": str(self.variant.id), "quantity": 1, "unit_price": "15000.00"}],
            )

        # 21st attempt in branch 1 must fail with 400
        resp = self.client_api.post(
            "/api/v1/sales/held/",
            {
                "branch": str(self.branch1.id),
                "label": "21st sale",
                "cart": [{"variant_id": str(self.variant.id), "quantity": 1, "unit_price": "15000.00"}],
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn("20", str(resp.data))

        # But branch 2 is under limit, should succeed
        resp_branch2 = self.client_api.post(
            "/api/v1/sales/held/",
            {
                "branch": str(self.branch2.id),
                "label": "Branch 2 sale",
                "cart": [{"variant_id": str(self.variant.id), "quantity": 1, "unit_price": "15000.00"}],
            },
            format="json",
        )
        self.assertEqual(resp_branch2.status_code, 201)

    def test_cashier_cannot_delete_or_resume_other_held_sale(self):
        held = HeldSale.objects.create(
            tenant=self.tenant,
            branch=self.branch1,
            cashier=self.cashier1,
            label="Cashier 1 ticket",
            cart=[{"variant_id": str(self.variant.id), "quantity": 1, "unit_price": "15000.00"}],
        )

        # Cashier 2 tries to delete Cashier 1's held sale
        self.client_api.force_authenticate(user=self.cashier2)
        del_resp = self.client_api.delete(f"/api/v1/sales/held/{held.id}/")
        self.assertEqual(del_resp.status_code, 404)

        # Cashier 2 tries to resume Cashier 1's held sale
        resume_resp = self.client_api.post(f"/api/v1/sales/held/{held.id}/resume/")
        self.assertEqual(resume_resp.status_code, 404)

        # Cashier 1 can resume and delete their own
        self.client_api.force_authenticate(user=self.cashier1)
        resume_ok = self.client_api.post(f"/api/v1/sales/held/{held.id}/resume/")
        self.assertEqual(resume_ok.status_code, 200)

        del_ok = self.client_api.delete(f"/api/v1/sales/held/{held.id}/")
        self.assertEqual(del_ok.status_code, 204)
        self.assertFalse(HeldSale.objects.filter(pk=held.id).exists())

    def test_resume_action_detects_price_and_stock_changes(self):
        held = HeldSale.objects.create(
            tenant=self.tenant,
            branch=self.branch1,
            cashier=self.cashier1,
            cart=[
                {
                    "variant_id": str(self.variant.id),
                    "quantity": 8,
                    "unit_price": "14000.00",  # Old price
                    "discount_amount": "0.00",
                }
            ],
        )

        # Current price in product is 15000.00 (changed from 14000.00)
        # Reduce available stock to 5
        StockMovement.objects.create(
            tenant=self.tenant,
            variant=self.variant,
            branch=self.branch1,
            reason=MovementReasonChoices.ADJUSTMENT,
            quantity_delta=-5,  # 10 - 5 = 5 remaining
        )

        self.client_api.force_authenticate(user=self.cashier1)
        resp = self.client_api.post(f"/api/v1/sales/held/{held.id}/resume/")
        self.assertEqual(resp.status_code, 200)

        cart = resp.data["cart"]
        changes = resp.data["changes"]

        self.assertEqual(len(cart), 1)
        # Quantity adjusted to available 5
        self.assertEqual(cart[0]["quantity"], 5)
        # Price updated to 15000.00
        self.assertEqual(Decimal(cart[0]["unit_price"]), Decimal("15000.00"))

        change_types = [c["type"] for c in changes]
        self.assertIn("qty_reduced", change_types)
        self.assertIn("price_changed", change_types)

    def test_resume_action_removes_out_of_stock_or_inactive(self):
        held = HeldSale.objects.create(
            tenant=self.tenant,
            branch=self.branch1,
            cashier=self.cashier1,
            cart=[
                {
                    "variant_id": str(self.variant.id),
                    "quantity": 2,
                    "unit_price": "15000.00",
                    "discount_amount": "0.00",
                }
            ],
        )

        # Deactivate variant
        self.variant.is_active = False
        self.variant.save()

        self.client_api.force_authenticate(user=self.cashier1)
        resp = self.client_api.post(f"/api/v1/sales/held/{held.id}/resume/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.data["cart"]), 0)
        self.assertEqual(resp.data["changes"][0]["type"], "removed")

    def test_completing_sale_with_held_sale_id_deletes_held_sale(self):
        held = HeldSale.objects.create(
            tenant=self.tenant,
            branch=self.branch1,
            cashier=self.cashier1,
            label="Pending checkout",
            cart=[{"variant_id": str(self.variant.id), "quantity": 1, "unit_price": "15000.00"}],
        )

        self.client_api.force_authenticate(user=self.cashier1)
        sale_data = {
            "branch_id": str(self.branch1.id),
            "held_sale_id": str(held.id),
            "items": [
                {
                    "variant_id": str(self.variant.id),
                    "quantity": 1,
                    "unit_price": "15000.00",
                    "discount_amount": "0.00",
                }
            ],
            "payments": [
                {
                    "amount": "15000.00",
                    "method": "cash",
                }
            ],
        }

        resp = self.client_api.post("/api/v1/sales/", sale_data, format="json")
        self.assertEqual(resp.status_code, 201)

        # Verify held sale was deleted atomically
        self.assertFalse(HeldSale.objects.filter(pk=held.id).exists())

    def test_cleanup_held_sales_task(self):
        now = timezone.now()
        # Old held sale (26 hours old)
        old_held = HeldSale.objects.create(
            tenant=self.tenant,
            cashier=self.cashier1,
            cart=[{"variant_id": str(self.variant.id), "quantity": 1, "unit_price": "15000.00"}],
        )
        HeldSale.objects.filter(pk=old_held.id).update(created_at=now - timedelta(hours=26))

        # Recent held sale (2 hours old)
        recent_held = HeldSale.objects.create(
            tenant=self.tenant,
            cashier=self.cashier1,
            cart=[{"variant_id": str(self.variant.id), "quantity": 1, "unit_price": "15000.00"}],
        )
        HeldSale.objects.filter(pk=recent_held.id).update(created_at=now - timedelta(hours=2))

        deleted = cleanup_held_sales()
        self.assertEqual(deleted, 1)
        self.assertFalse(HeldSale.objects.filter(pk=old_held.id).exists())
        self.assertTrue(HeldSale.objects.filter(pk=recent_held.id).exists())

    def test_resume_masks_costs_for_cashier_hydrates_client_and_clamps_discount(self):
        """
        Resuming a held sale as a cashier must mask purchase_price/margin_pct on variant & product,
        return the full serialized client when attached, and clamp line discount when quantity is reduced.
        Also verifies a cashier cannot delete another cashier's held sale via held_sale_id on checkout,
        and negative cart quantities are rejected.
        """
        from apps.clients.models import Client

        customer = Client.objects.create(
            tenant=self.tenant,
            name="Client Fidèle",
            phone="0550998877",
            credit_limit=Decimal("50000.00"),
        )

        # Negative quantity in cart is rejected by HeldSaleItemInput validation
        self.client_api.force_authenticate(user=self.cashier1)
        bad_cart_resp = self.client_api.post(
            "/api/v1/sales/held/",
            {
                "branch": str(self.branch1.id),
                "cart": [{"variant_id": str(self.variant.id), "quantity": -2, "unit_price": "15000.00"}],
            },
            format="json",
        )
        self.assertEqual(bad_cart_resp.status_code, 400)

        held = HeldSale.objects.create(
            tenant=self.tenant,
            branch=self.branch1,
            cashier=self.cashier1,
            client=customer,
            label="Panier avec client et remise",
            cart=[
                {
                    "variant_id": str(self.variant.id),
                    "quantity": 10,
                    "unit_price": "15000.00",
                    "discount_amount": "30000.00",  # 30,000 DA discount across 10 pairs
                }
            ],
        )

        # Reduce branch1 stock from 10 to 1 pair so 30,000 DA discount exceeds 1 * 15,000 DA
        StockMovement.objects.create(
            tenant=self.tenant,
            variant=self.variant,
            branch=self.branch1,
            reason=MovementReasonChoices.ADJUSTMENT,
            quantity_delta=-9,
        )

        self.client_api.force_authenticate(user=self.cashier1)
        resume_resp = self.client_api.post(f"/api/v1/sales/held/{held.id}/resume/")
        self.assertEqual(resume_resp.status_code, 200)

        # 1. Cost fields masked for cashier
        cart_line = resume_resp.data["cart"][0]
        self.assertNotIn("purchase_price", cart_line["variant"])
        self.assertNotIn("purchase_price", cart_line["product"])
        self.assertNotIn("margin_pct", cart_line["product"])

        # 2. Full client object hydrated in resume response
        self.assertIsNotNone(resume_resp.data.get("client"))
        self.assertEqual(str(resume_resp.data["client"]["id"]), str(customer.id))
        self.assertEqual(resume_resp.data["client"]["phone"], "0550998877")

        # 3. Line discount clamped to new line subtotal (1 * 15000.00 = 15000.00)
        self.assertEqual(cart_line["quantity"], 1)
        self.assertEqual(Decimal(cart_line["discount_amount"]), Decimal("15000.00"))

        # 4. Cashier 2 cannot delete Cashier 1's held sale by passing held_sale_id on checkout
        self.client_api.force_authenticate(user=self.cashier2)
        sale_resp = self.client_api.post(
            "/api/v1/sales/",
            {
                "branch_id": str(self.branch1.id),
                "held_sale_id": str(held.id),
                "items": [
                    {
                        "variant_id": str(self.variant.id),
                        "quantity": 1,
                        "unit_price": "15000.00",
                        "discount_amount": "0.00",
                    }
                ],
                "payments": [{"amount": "15000.00", "method": "cash"}],
            },
            format="json",
        )
        self.assertEqual(sale_resp.status_code, 201)
        # Cashier 1's held sale must still exist!
        self.assertTrue(HeldSale.objects.filter(pk=held.id).exists())

