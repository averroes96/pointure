from rest_framework import serializers

from apps.mobile.models import DeviceToken


class DeviceTokenSerializer(serializers.ModelSerializer):
    class Meta:
        model = DeviceToken
        fields = ["id", "token", "platform", "created_at"]
        read_only_fields = ["id", "created_at"]

    def create(self, validated_data):
        # Upsert: if the token already exists for this user, update platform.
        obj, _ = DeviceToken.objects.update_or_create(
            user=validated_data["user"],
            token=validated_data["token"],
            defaults={
                "platform": validated_data["platform"],
                "tenant": validated_data["tenant"],
            },
        )
        return obj
