from types import SimpleNamespace
import pytest
from django.contrib.auth.models import AnonymousUser

from apps.core.models import RoleChoices, Tenant, User
from apps.core.permissions import (
    ALL_ROLES,
    MANAGER_OR_OWNER,
    OWNER_ONLY,
    IsManagerOrOwner,
    IsOwner,
    RolePermission,
)


@pytest.mark.django_db
class TestCentralRolePermissions:
    """Unit tests for IsOwner, IsManagerOrOwner, and RolePermission (Task 2.1)."""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.tenant = Tenant.objects.create(name="Permissions Shop")
        self.owner = User.objects.create_user(
            email="owner@perm.com",
            password="password123",
            tenant=self.tenant,
            role=RoleChoices.OWNER,
        )
        self.manager = User.objects.create_user(
            email="manager@perm.com",
            password="password123",
            tenant=self.tenant,
            role=RoleChoices.MANAGER,
        )
        self.cashier = User.objects.create_user(
            email="cashier@perm.com",
            password="password123",
            tenant=self.tenant,
            role=RoleChoices.CASHIER,
        )
        self.superuser = User.objects.create_superuser(
            email="super@perm.com",
            password="password123",
            phone="0550000099",
        )
        self.anon = AnonymousUser()

    @staticmethod
    def _req(user, method="GET"):
        return SimpleNamespace(user=user, method=method)

    def test_is_owner_permission(self):
        perm = IsOwner()
        view = SimpleNamespace()
        assert perm.has_permission(self._req(self.owner), view) is True
        assert perm.has_permission(self._req(self.superuser), view) is True
        assert perm.has_permission(self._req(self.manager), view) is False
        assert perm.has_permission(self._req(self.cashier), view) is False
        assert perm.has_permission(self._req(self.anon), view) is False

    def test_is_manager_or_owner_permission(self):
        perm = IsManagerOrOwner()
        view = SimpleNamespace()
        assert perm.has_permission(self._req(self.owner), view) is True
        assert perm.has_permission(self._req(self.manager), view) is True
        assert perm.has_permission(self._req(self.superuser), view) is True
        assert perm.has_permission(self._req(self.cashier), view) is False
        assert perm.has_permission(self._req(self.anon), view) is False

    def test_role_permission_action_and_default_map(self):
        perm = RolePermission()
        view_map = {
            "list": ALL_ROLES,
            "create": MANAGER_OR_OWNER,
            "destroy": OWNER_ONLY,
            "default": MANAGER_OR_OWNER,
        }

        # Action 'list': cashier allowed
        list_view = SimpleNamespace(action="list", role_permissions=view_map)
        assert perm.has_permission(self._req(self.cashier), list_view) is True
        assert perm.has_permission(self._req(self.manager), list_view) is True
        assert perm.has_permission(self._req(self.owner), list_view) is True

        # Action 'create': manager and owner allowed, cashier denied
        create_view = SimpleNamespace(action="create", role_permissions=view_map)
        assert perm.has_permission(self._req(self.cashier), create_view) is False
        assert perm.has_permission(self._req(self.manager), create_view) is True
        assert perm.has_permission(self._req(self.owner), create_view) is True

        # Action 'destroy': owner and superuser allowed, manager and cashier denied
        destroy_view = SimpleNamespace(action="destroy", role_permissions=view_map)
        assert perm.has_permission(self._req(self.cashier), destroy_view) is False
        assert perm.has_permission(self._req(self.manager), destroy_view) is False
        assert perm.has_permission(self._req(self.owner), destroy_view) is True
        assert perm.has_permission(self._req(self.superuser), destroy_view) is True

        # Unlisted action 'custom_action' falls back to 'default' (MANAGER_OR_OWNER)
        custom_view = SimpleNamespace(action="custom_action", role_permissions=view_map)
        assert perm.has_permission(self._req(self.cashier), custom_view) is False
        assert perm.has_permission(self._req(self.manager), custom_view) is True
        assert perm.has_permission(self._req(self.anon), custom_view) is False

    def test_role_permission_fails_closed_when_default_unspecified(self):
        """When a view has no 'default' specified in role_permissions, unmapped actions default to MANAGER_OR_OWNER."""
        perm = RolePermission()
        view_map = {
            "list": ALL_ROLES,
            # Note: No 'default' key here!
        }
        # Explicitly mapped action allows cashier
        list_view = SimpleNamespace(action="list", role_permissions=view_map)
        assert perm.has_permission(self._req(self.cashier), list_view) is True

        # Unmapped actions fail closed: cashier denied, manager and owner allowed
        unmapped_create = SimpleNamespace(action="create", role_permissions=view_map)
        assert perm.has_permission(self._req(self.cashier), unmapped_create) is False
        assert perm.has_permission(self._req(self.manager), unmapped_create) is True
        assert perm.has_permission(self._req(self.owner), unmapped_create) is True

        unmapped_destroy = SimpleNamespace(action="destroy", role_permissions=view_map)
        assert perm.has_permission(self._req(self.cashier), unmapped_destroy) is False
        assert perm.has_permission(self._req(self.manager), unmapped_destroy) is True
        assert perm.has_permission(self._req(self.owner), unmapped_destroy) is True



@pytest.mark.django_db
class TestMeProfilePrivilegeEscalation:
    """Verifies that /core/me/update_profile/ cannot be used to escalate privileges."""

    def test_cashier_cannot_escalate_role_or_permissions_via_update_profile(self):
        from rest_framework.test import APIClient
        tenant = Tenant.objects.create(name="Escalation Test")
        cashier = User.objects.create_user(
            email="cashier@escalate.com",
            password="testpass123",
            tenant=tenant,
            role=RoleChoices.CASHIER,
            max_discount_pct=10,
            can_modify_price=False,
            can_process_returns=False,
            can_cancel_sale=False,
        )
        client = APIClient()
        client.force_authenticate(user=cashier)
        payload = {
            "role": RoleChoices.OWNER,
            "is_active": False,
            "max_discount_pct": 50,
            "can_modify_price": True,
            "can_process_returns": True,
            "can_cancel_sale": True,
            "first_name": "NewName",
        }
        res = client.patch("/api/v1/core/me/update_profile/", payload, format="json")
        assert res.status_code == 200, res.data
        cashier.refresh_from_db()
        assert cashier.first_name == "NewName"
        assert cashier.role == RoleChoices.CASHIER
        assert cashier.is_active is True
        assert cashier.max_discount_pct == 10
        assert cashier.can_modify_price is False
        assert cashier.can_process_returns is False
        assert cashier.can_cancel_sale is False

    def test_user_can_update_own_profile_fields(self):
        from rest_framework.test import APIClient
        tenant = Tenant.objects.create(name="Profile Test")
        cashier = User.objects.create_user(
            email="cashier2@escalate.com",
            password="testpass123",
            tenant=tenant,
            role=RoleChoices.CASHIER,
            first_name="OldFirst",
            last_name="OldLast",
            phone="0550111222",
            language_preference="fr",
        )
        client = APIClient()
        client.force_authenticate(user=cashier)
        payload = {
            "first_name": "NewFirst",
            "last_name": "NewLast",
            "phone": "0550333444",
            "language_preference": "ar",
        }
        res = client.patch("/api/v1/core/me/update_profile/", payload, format="json")
        assert res.status_code == 200, res.data
        cashier.refresh_from_db()
        assert cashier.first_name == "NewFirst"
        assert cashier.last_name == "NewLast"
        assert cashier.phone == "0550333444"
        assert cashier.language_preference == "ar"
        assert cashier.role == RoleChoices.CASHIER


@pytest.mark.django_db
class TestUserManagementPrivilegeEscalation:
    """Verifies that a manager cannot reset an owner's password or escalate role to owner via UserViewSet."""

    def setup_method(self):
        from rest_framework.test import APIClient
        self.client = APIClient()
        self.tenant = Tenant.objects.create(name="Escalation Store")
        self.owner = User.objects.create_user(
            email="owner@store.com",
            phone="0550111111",
            password="ownerpass123",
            tenant=self.tenant,
            role=RoleChoices.OWNER,
        )
        self.manager = User.objects.create_user(
            email="manager@store.com",
            phone="0550222222",
            password="managerpass123",
            tenant=self.tenant,
            role=RoleChoices.MANAGER,
        )
        self.cashier = User.objects.create_user(
            email="cashier@store.com",
            phone="0550333333",
            password="cashierpass123",
            tenant=self.tenant,
            role=RoleChoices.CASHIER,
        )

    def test_manager_cannot_reset_owner_password(self):
        self.client.force_authenticate(user=self.manager)
        res = self.client.post(
            f"/api/v1/core/users/{self.owner.id}/reset-password/",
            {"new_password": "hijackedpassword123"},
            format="json",
        )
        assert res.status_code == 403
        self.owner.refresh_from_db()
        assert self.owner.check_password("ownerpass123")
        assert not self.owner.check_password("hijackedpassword123")

    def test_manager_cannot_patch_own_role_to_owner(self):
        self.client.force_authenticate(user=self.manager)
        res = self.client.patch(
            f"/api/v1/core/users/{self.manager.id}/",
            {"role": RoleChoices.OWNER},
            format="json",
        )
        assert res.status_code == 403
        self.manager.refresh_from_db()
        assert self.manager.role == RoleChoices.MANAGER

    def test_manager_cannot_modify_owner_account(self):
        self.client.force_authenticate(user=self.manager)
        res = self.client.patch(
            f"/api/v1/core/users/{self.owner.id}/",
            {"first_name": "Tampered", "is_active": False},
            format="json",
        )
        assert res.status_code == 403
        self.owner.refresh_from_db()
        assert self.owner.first_name != "Tampered"
        assert self.owner.is_active is True

    def test_manager_cannot_create_owner_user(self):
        self.client.force_authenticate(user=self.manager)
        payload = {
            "phone": "0550444444",
            "first_name": "Second",
            "last_name": "Owner",
            "password": "newpassword123",
            "confirm_password": "newpassword123",
            "role": RoleChoices.OWNER,
        }
        res = self.client.post("/api/v1/core/users/", payload, format="json")
        assert res.status_code == 403
        assert not User.objects.filter(phone="+213550444444").exists()

    def test_manager_cannot_set_owner_pin(self):
        self.client.force_authenticate(user=self.manager)
        res = self.client.post(
            f"/api/v1/core/users/{self.owner.id}/set-pin/",
            {"pin": "9999"},
            format="json",
        )
        assert res.status_code == 403
        self.owner.refresh_from_db()
        assert not self.owner.check_pin("9999")

    def test_manager_cannot_change_own_role(self):
        self.client.force_authenticate(user=self.manager)
        res = self.client.patch(
            f"/api/v1/core/users/{self.manager.id}/",
            {"role": RoleChoices.CASHIER},
            format="json",
        )
        assert res.status_code == 403
        self.manager.refresh_from_db()
        assert self.manager.role == RoleChoices.MANAGER

    def test_owner_can_reset_manager_and_cashier_password(self):
        self.client.force_authenticate(user=self.owner)
        res = self.client.post(
            f"/api/v1/core/users/{self.manager.id}/reset-password/",
            {"new_password": "newmanagerpass123"},
            format="json",
        )
        assert res.status_code == 200
        self.manager.refresh_from_db()
        assert self.manager.check_password("newmanagerpass123")

    def test_manager_can_reset_cashier_password(self):
        self.client.force_authenticate(user=self.manager)
        res = self.client.post(
            f"/api/v1/core/users/{self.cashier.id}/reset-password/",
            {"new_password": "newcashierpass123"},
            format="json",
        )
        assert res.status_code == 200
        self.cashier.refresh_from_db()
        assert self.cashier.check_password("newcashierpass123")



