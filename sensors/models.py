import uuid

from django.db import models
from django.utils import timezone


class SensorDevice(models.Model):
    device_id = models.CharField(max_length=100, primary_key=True)
    name = models.CharField(max_length=120)
    gpio_pin = models.PositiveSmallIntegerField(default=27)
    light_gpio_pin = models.PositiveSmallIntegerField(default=26)
    smoke_gpio_pin = models.PositiveSmallIntegerField(default=13)
    last_seen = models.DateTimeField(null=True, blank=True, db_index=True)
    sound_detected = models.BooleanField(default=False)
    light_detected = models.BooleanField(default=False)
    smoke_detected = models.BooleanField(default=False)

    def __str__(self):
        return self.name


class SoundReading(models.Model):
    device = models.ForeignKey(SensorDevice, on_delete=models.CASCADE, related_name="readings")
    sound_detected = models.BooleanField()
    received_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-received_at"]
        indexes = [models.Index(fields=["device", "-received_at"])]


class LightReading(models.Model):
    device = models.ForeignKey(SensorDevice, on_delete=models.CASCADE, related_name="light_readings")
    detected = models.BooleanField()
    received_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-received_at"]
        indexes = [models.Index(fields=["device", "-received_at"])]


class SmokeReading(models.Model):
    device = models.ForeignKey(SensorDevice, on_delete=models.CASCADE, related_name="smoke_readings")
    detected = models.BooleanField()
    received_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-received_at"]
        indexes = [models.Index(fields=["device", "-received_at"])]


class TelemetryReading(models.Model):
    device = models.ForeignKey(SensorDevice, on_delete=models.CASCADE, related_name="telemetry")
    payload = models.JSONField()
    received_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        indexes = [models.Index(fields=["device", "-received_at"])]


class ServoCommand(models.Model):
    device_id = models.CharField(max_length=100, db_index=True)
    angle = models.PositiveSmallIntegerField()
    status = models.CharField(max_length=20, default="pending")
    created_at = models.DateTimeField(auto_now_add=True)
    confirmed_at = models.DateTimeField(null=True)


class ServoAccessGuard(models.Model):
    key = models.CharField(max_length=20, primary_key=True)
    failures = models.PositiveSmallIntegerField(default=0)
    blocked_until = models.DateTimeField(null=True)


class WebhookDelivery(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    device_id = models.CharField(max_length=100)
    kind = models.CharField(max_length=20)
    payload = models.JSONField()
    created_at = models.DateTimeField(auto_now_add=True)
    attempts = models.PositiveIntegerField(default=0)
    next_attempt_at = models.DateTimeField(default=timezone.now, db_index=True)
    delivered_at = models.DateTimeField(null=True, db_index=True)
    last_error = models.CharField(max_length=80, blank=True)

    class Meta:
        indexes = [models.Index(fields=["device_id", "kind", "-created_at"])]
