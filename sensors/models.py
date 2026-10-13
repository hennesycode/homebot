from django.db import models


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
