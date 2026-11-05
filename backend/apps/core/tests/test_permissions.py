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

