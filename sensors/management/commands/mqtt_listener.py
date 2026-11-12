import hashlib
import hmac
import json
import logging
import os
import time
import urllib.error
import urllib.request
import uuid
from datetime import timedelta

import paho.mqtt.client as mqtt
from django.core.management.base import BaseCommand
from django.db import DatabaseError, close_old_connections, transaction
from django.utils import timezone
from urllib.parse import urlparse

from sensors.models import LightReading, SensorDevice, ServoCommand, SmokeReading, SoundReading, TelemetryReading
from sensors.sensor_notifications import enqueue, queue_sensor_notifications
from sensors.servo_contract import valid_angle

logger = logging.getLogger(__name__)


def store_servo_ack(device_id, payload):
    ack = json.loads(payload)
    if (isinstance(ack, dict) and type(ack.get("id")) is int and ack.get("error") == "pwm_unavailable"):
        return ServoCommand.objects.filter(pk=ack["id"], device_id=device_id, status="pending",
                                           created_at__gte=timezone.now()-timedelta(seconds=10)).update(status="failed")
    if (not isinstance(ack, dict) or type(ack.get("id")) is not int or
            not valid_angle(ack.get("angle"))):
        raise ValueError("Invalid servo acknowledgement")
    now = timezone.now()
    with transaction.atomic():
        updated = ServoCommand.objects.filter(pk=ack["id"], device_id=device_id,
                                              angle=ack["angle"], status="pending",
                                              created_at__gte=now-timedelta(seconds=10)).update(
            status="confirmed", confirmed_at=now)
        if updated:
            enqueue(device_id, {"id": "servo", "name": "Servo SG90", "type": "servo", "pin": 23,
                                "value": ack["angle"], "unit": "requested_degrees"},
                    "servo", now, "command_acknowledged")
    return updated


def send_hermes_alert(payload, request_id=None):
    url = os.getenv("HOMEBOT_HERMES_WEBHOOK_URL", "").strip()
    secret = os.getenv("HOMEBOT_HERMES_WEBHOOK_SECRET", "")
    if not url or not secret:
        return False
    destination = urlparse(url)
    if destination.scheme != "https" or not destination.hostname or destination.username or destination.password:
        logger.error("Hermes webhook requires HTTPS")
        return False

    timestamp = str(int(time.time()))
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    signed_content = timestamp.encode("ascii") + b"." + body
    signature = hmac.new(secret.encode("utf-8"), signed_content, hashlib.sha256).hexdigest()
    request = urllib.request.Request(
        url,
        data=body,
        headers={
            "Content-Type": "application/json",
            "X-Webhook-Timestamp": timestamp,
            "X-Webhook-Signature-V2": signature,
            "X-Request-ID": str(request_id or uuid.uuid4()),
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            logger.info("Hermes accepted sensor alert (HTTP %s)", response.status)
            return 200 <= response.status < 300
    except urllib.error.HTTPError as exc:
        logger.error("Hermes rejected sensor alert (HTTP %s)", exc.code)
    except (OSError, TimeoutError) as exc:
        logger.warning("Hermes webhook unavailable: %s", type(exc).__name__)
    return False


class Command(BaseCommand):
    help = "Receives sensor telemetry from the MQTT broker and stores it in Django."

    def handle(self, *args, **options):
        last_cleanup = 0
        client = mqtt.Client(
            mqtt.CallbackAPIVersion.VERSION2,
            client_id=f"homebot-{os.getenv('DEVICE_ID', 'dashboard')}",
        )
        client.username_pw_set(os.getenv("MQTT_USERNAME", ""), os.getenv("MQTT_PASSWORD", ""))
        if os.getenv("MQTT_TLS", "false").lower() == "true":
            client.tls_set()
        client.reconnect_delay_set(min_delay=1, max_delay=30)

        def on_connect(client, _userdata, _flags, reason_code, _properties):
            if reason_code.is_failure:
                logger.error("MQTT connection failed: %s", reason_code)
                return
            client.subscribe("sensors/+/telemetry", qos=1)
            client.subscribe("sensors/+/events", qos=1)
            client.subscribe("sensors/+/servo/status", qos=1)
            self.stdout.write("Connected to MQTT; listening for sensor telemetry and events")

        def on_message(_client, _userdata, message):
            nonlocal last_cleanup
            parts = message.topic.split("/")
            if len(parts) == 4 and parts[0] == "sensors" and parts[2:] == ["servo", "status"]:
                if message.retain:
                    return
                try:
                    close_old_connections()
                    store_servo_ack(parts[1], message.payload)
                except (ValueError, TypeError, UnicodeDecodeError, DatabaseError):
                    logger.warning("Invalid or unavailable servo acknowledgement")
                finally:
                    close_old_connections()
                return
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
                smoke_detected = payload.get("smoke_detected")
                if smoke_detected is not None and not isinstance(smoke_detected, bool):
                    raise ValueError("smoke_detected must be boolean")
                smoke_pin = payload.get("smoke_pin", 13)
                if not isinstance(smoke_pin, int) or not 0 <= smoke_pin <= 39:
                    raise ValueError("smoke_pin is invalid")
                changed_sensor = payload.get("changed_sensor")
                if changed_sensor not in (None, "sound", "light", "smoke", "mq2"):
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
                            "smoke_gpio_pin": smoke_pin,
                            "last_seen": timezone.now(),
                            "sound_detected": detected,
                            "light_detected": light_detected if light_detected is not None else False,
                            "smoke_detected": smoke_detected if smoke_detected is not None else False,
                        },
                    )
                    if parts[2] == "telemetry" or changed_sensor == "sound":
                        SoundReading.objects.create(device=device, sound_detected=detected)
                    if light_detected is not None and (parts[2] == "telemetry" or changed_sensor == "light"):
                        LightReading.objects.create(device=device, detected=light_detected)
                    if smoke_detected is not None and (parts[2] == "telemetry" or changed_sensor == "smoke"):
                        SmokeReading.objects.create(device=device, detected=smoke_detected)
                    if not message.retain:
                        TelemetryReading.objects.create(device=device, payload=payload)
                        queue_sensor_notifications(parts[1], payload, parts[2])
            except DatabaseError:
                logger.exception("Failed to store telemetry from %s", parts[1])
            finally:
                close_old_connections()

            if time.monotonic() - last_cleanup > 3600:
                try:
                    TelemetryReading.objects.filter(received_at__lt=timezone.now() - timedelta(days=1)).delete()
                    last_cleanup = time.monotonic()
                except DatabaseError:
                    logger.exception("Telemetry history cleanup failed")

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
