from rest_framework import serializers


class ActivateRequestSerializer(serializers.Serializer):
    license_key = serializers.CharField(max_length=64)
    machine_id = serializers.CharField(max_length=64)
    hostname = serializers.CharField(max_length=200, required=False, default="")
    app_version = serializers.CharField(max_length=20, required=False, default="")


class HeartbeatRequestSerializer(serializers.Serializer):
    license_key = serializers.CharField(max_length=64)
    machine_id = serializers.CharField(max_length=64)
    app_version = serializers.CharField(max_length=20, required=False, default="")
