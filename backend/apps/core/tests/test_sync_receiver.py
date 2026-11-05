from django.test import TestCase, override_settings
from rest_framework.test import APIClient, APIRequestFactory
from rest_framework import status
from apps.core.views import SyncReceiverView


class SyncReceiverSecurityTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.factory = APIRequestFactory()

    def test_sync_push_route_is_disabled_and_returns_404(self):
        """Task 3.2: Ensure /api/v1/core/sync/push/ route is removed/disabled and returns 404."""
        response = self.client.post(
            "/api/v1/core/sync/push/",
            {"events": []},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_sync_receiver_view_rejects_when_node_api_key_is_empty(self):
        """Ensure that even if invoked directly, SyncReceiverView rejects if NODE_API_KEY is not set."""
        with override_settings(NODE_API_KEY=""):
            request = self.factory.post(
                "/api/v1/core/sync/push/",
                {"events": []},
                format="json",
            )
            view = SyncReceiverView.as_view()
            response = view(request)
            self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)
            self.assertEqual(response.data.get("error"), "Unauthorized node")

    def test_sync_receiver_view_rejects_when_key_mismatches(self):
        """Ensure SyncReceiverView rejects requests with mismatched Authorization header."""
        with override_settings(NODE_API_KEY="secret-node-key-123"):
            request = self.factory.post(
                "/api/v1/core/sync/push/",
                {"events": []},
                HTTP_AUTHORIZATION="Bearer wrong-key",
                format="json",
            )
            view = SyncReceiverView.as_view()
            response = view(request)
            self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

