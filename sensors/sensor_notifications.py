"""Notifications preserve the existing signed sensor_alert webhook envelope."""
import math
import os
from datetime import timedelta

from django.utils import timezone

from .models import WebhookDelivery


def number(value):
    try:
        return value if type(value) in (int, float) and math.isfinite(value) else None
    except OverflowError:
        return None


def sensor_reports(data):
    sound = data.get("sound_detected")
    light = data.get("light_detected")
    do_high = data.get("mq2_do_high")
    return [
        {"id": "distance", "name": "Ultrasónico HC-SR04", "type": "distance", "pin": 19,
         "trig_pin": 18, "value": number(data.get("distance_cm")), "unit": "cm"},
        {"id": "dht11", "name": "Temperatura y humedad DHT11", "type": "temperature_humidity", "pin": 32,
         "value": number(data.get("temperature_c")), "unit": "celsius",
         "humidity_pct": number(data.get("humidity_pct"))},
        {"id": "mq2", "name": "Detector MQ-2 (sin calibrar)", "type": "gas", "pin": 34,
         "value": number(data.get("mq2_ao_raw")), "unit": "adc_raw", "digital_pin": 27,
         "digital_high": do_high if type(do_high) is bool else None, "calibrated": False},
        {"id": "sound", "name": "Sensor de sonido", "type": "sound", "pin": data.get("sound_pin", 25),
         "value": int(sound) if type(sound) is bool else None, "unit": "digital"},
        {"id": "light", "name": "Sensor de luz", "type": "light", "pin": data.get("light_pin", 26),
         "value": int(light) if type(light) is bool else None, "unit": "digital"},
    ]


def enqueue(device_id, sensor, kind, occurred_at, reason):
    delivery = WebhookDelivery(device_id=device_id, kind=kind)
    value = sensor["value"]
    if value is None:
        state = "unavailable"
    elif sensor["unit"] == "digital":
        state = "detected" if value else "clear"
    elif sensor["id"] == "mq2":
        state = "uncalibrated"
    elif sensor["id"] == "servo":
        state = "pwm_confirmed"
    else:
        state = "reading"
    delivery.payload = {"event_type": "sensor_alert", "event_id": str(delivery.pk),
                        "device_id": device_id, "sensor": sensor, "state": state,
                        "reason": reason, "occurred_at": occurred_at.isoformat()}
    delivery.save()


def queue_sensor_notifications(device_id, data, channel):
    now = timezone.now()
    reports = sensor_reports(data)
    if channel == "events":
        changed = data.get("changed_sensor")
        if changed == "smoke" and type(data.get("smoke_detected")) is bool:
            enqueue(device_id, {"id": "smoke", "name": "Sensor de humo legado", "type": "smoke",
                                "pin": data.get("smoke_pin", 13), "value": int(data["smoke_detected"]),
                                "unit": "digital"}, "event", now, "state_changed")
        for sensor in reports:
            if sensor["id"] == changed:
                enqueue(device_id, sensor, "event", now, "state_changed")
        return
    try:
        interval = max(5, int(os.getenv("HOMEBOT_SENSOR_REPORT_SECONDS", "30")))
    except ValueError:
        interval = 30
    cutoff = now - timedelta(seconds=interval)
    if not WebhookDelivery.objects.filter(device_id=device_id, kind="snapshot", created_at__gte=cutoff).exists():
        for sensor in reports:
            enqueue(device_id, sensor, "snapshot", now, "periodic_reading")
