from rest_framework import serializers
from .models import Notification


class NotificationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Notification
        fields = ["id", "type", "title", "body", "read", "related_object_type",
                  "related_object_id", "created_at"]
        read_only_fields = ["id", "created_at"]
