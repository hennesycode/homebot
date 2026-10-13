import json
import logging
import os
import time

import paho.mqtt.client as mqtt
from django.core.management.base import BaseCommand
from django.db import DatabaseError, close_old_connections, transaction
from django.utils import timezone

from sensors.models import LightReading, SensorDevice, SoundReading

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = "Receives sensor telemetry from the MQTT broker and stores it in Django."

    def handle(self, *args, **options):
        client = mqtt.Client(
            mqtt.CallbackAPIVersion.VERSION2,
            client_id=f"homebot-{os.getenv('DEVICE_ID', 'dashboard')}",
        )
        client.username_pw_set(os.getenv("MQTT_USERNAME", ""), os.getenv("MQTT_PASSWORD", ""))
        client.reconnect_delay_set(min_delay=1, max_delay=30)

        def on_connect(client, _userdata, _flags, reason_code, _properties):
            if reason_code.is_failure:
                logger.error("MQTT connection failed: %s", reason_code)
                return
            client.subscribe("sensors/+/telemetry", qos=1)
            client.subscribe("sensors/+/events", qos=1)
            self.stdout.write("Connected to MQTT; listening for sensor telemetry and events")

        def on_message(_client, _userdata, message):
            parts = message.topic.split("/")
            if len(parts) != 3 or parts[0] != "sensors" or parts[2] not in ("telemetry", "events"):
                return
            try:
                payload = json.loads(message.payload)
                detected = payload["sound_detected"]
                if not isinstance(detected, bool):
                    raise ValueError("sound_detected must be boolean")
                sensor_name = payload.get("sensor_name", parts[1])
                if not isinstance(sensor_name, str) or not sensor_name.strip() or len(sensor_name) > 120:
                    raise ValueError("sensor_name is invalid")
                pin = payload.get("sound_pin", 27)
                if not isinstance(pin, int) or not 0 <= pin <= 39:
                    raise ValueError("sound_pin is invalid")
                light_detected = payload.get("light_detected")
                if light_detected is not None and not isinstance(light_detected, bool):
                    raise ValueError("light_detected must be boolean")
                light_pin = payload.get("light_pin", 26)
                if not isinstance(light_pin, int) or not 0 <= light_pin <= 39:
                    raise ValueError("light_pin is invalid")
                changed_sensor = payload.get("changed_sensor")
                if changed_sensor not in (None, "sound", "light"):
                    raise ValueError("changed_sensor is invalid")
            except (UnicodeDecodeError, json.JSONDecodeError, KeyError, TypeError, ValueError) as exc:
                logger.warning("Ignoring invalid MQTT message on %s: %s", message.topic, exc)
                return

            close_old_connections()
            try:
                with transaction.atomic():
                    device, _ = SensorDevice.objects.update_or_create(
                        device_id=parts[1],
                        defaults={
                            "name": sensor_name.strip(),
                            "gpio_pin": pin,
                            "light_gpio_pin": light_pin,
                            "last_seen": timezone.now(),
                            "sound_detected": detected,
                            "light_detected": light_detected if light_detected is not None else False,
                        },
                    )
                    if parts[2] == "telemetry" or changed_sensor == "sound":
                        SoundReading.objects.create(device=device, sound_detected=detected)
                    if light_detected is not None and (parts[2] == "telemetry" or changed_sensor == "light"):
                        LightReading.objects.create(device=device, detected=light_detected)
            except DatabaseError:
                logger.exception("Failed to store telemetry from %s", parts[1])
            finally:
                close_old_connections()

        client.on_connect = on_connect
        client.on_message = on_message
        host = os.getenv("MQTT_HOST", "localhost")
        port = int(os.getenv("MQTT_PORT", "1883"))
        while True:
            try:
                client.connect(host, port, keepalive=60)
                client.loop_forever()
            except OSError as exc:
                logger.warning("MQTT unavailable (%s); retrying in 5 seconds", exc)
                time.sleep(5)
