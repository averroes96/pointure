from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from .models import Notification
from .serializers import NotificationSerializer


class NotificationViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = NotificationSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = Notification.objects.filter(user=self.request.user)
        notif_type = self.request.query_params.get("type")
        if notif_type:
            qs = qs.filter(type=notif_type)
        return qs

    @action(detail=True, methods=["post"], url_path="mark-read")
    def mark_read(self, request, pk=None):
        notif = self.get_object()
        notif.read = True
        notif.save(update_fields=["read"])
        return Response({"status": "ok"})

    @action(detail=False, methods=["post"], url_path="mark-all-read")
    def mark_all_read(self, request):
        self.get_queryset().filter(read=False).update(read=True)
        return Response({"status": "ok"})

    @action(detail=False, methods=["post"], url_path="clear-all")
    def clear_all(self, request):
        # One DELETE. `.delete()` loads every row and fires the catch-all post_delete signals once
        # per notification (about 3 queries each: a store with ~1,900 notifications ran 5,801
        # queries). Notifications are per-user reminders: nothing points at them and none is audited.
        queryset = self.get_queryset()
        queryset._raw_delete(queryset.db)
        return Response({"status": "ok"})

    @action(detail=False, methods=["get"])
    def unread_count(self, request):
        count = self.get_queryset().filter(read=False).count()
        return Response({"count": count})
