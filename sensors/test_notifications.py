import os
from datetime import timedelta
from unittest.mock import patch

from django.db import transaction
from django.test import TestCase
from django.utils import timezone

from .management.commands.deliver_alerts import deliver_pending
from .models import WebhookDelivery
from .sensor_notifications import queue_sensor_notifications


READING = {"distance_cm": 25.5, "temperature_c": 28.5, "humidity_pct": 68.1,
           "sound_detected": False, "light_detected": True,
           "mq2_ao_raw": 0, "mq2_do_high": True}


class NotificationTests(TestCase):
    def test_all_five_sensors_and_periodic_limit(self):
        queue_sensor_notifications("unit", READING, "telemetry")
        rows = list(WebhookDelivery.objects.all())
        self.assertEqual({r.payload["sensor"]["id"] for r in rows}, {"distance", "dht11", "mq2", "sound", "light"})
        humidity = next(r for r in rows if r.payload["sensor"]["id"] == "dht11")
        self.assertEqual(humidity.payload["sensor"]["humidity_pct"], 68.1)
        mq2 = next(r for r in rows if r.payload["sensor"]["id"] == "mq2")
        self.assertEqual(mq2.payload["sensor"]["value"], 0)
        self.assertEqual(mq2.payload["state"], "uncalibrated")
        self.assertTrue(mq2.payload["sensor"]["digital_high"])
        queue_sensor_notifications("unit", READING, "telemetry")
        self.assertEqual(WebhookDelivery.objects.count(), 5)
        WebhookDelivery.objects.update(created_at=timezone.now()-timedelta(seconds=31))
        queue_sensor_notifications("unit", READING, "telemetry")
        self.assertEqual(WebhookDelivery.objects.count(), 10)

    def test_clear_event_and_unavailable_reading(self):
        queue_sensor_notifications("unit", {**READING, "changed_sensor":"sound"}, "events")
        event = WebhookDelivery.objects.get()
        self.assertEqual(event.payload["state"], "clear")
        queue_sensor_notifications("other", {**READING, "temperature_c":None}, "telemetry")
        dht = next(r for r in WebhookDelivery.objects.filter(device_id="other") if r.payload["sensor"]["id"] == "dht11")
        self.assertIsNone(dht.payload["sensor"]["value"])
        self.assertEqual(dht.payload["state"], "unavailable")

    def test_atomic_queue(self):
        with self.assertRaises(RuntimeError):
            with transaction.atomic():
                queue_sensor_notifications("unit", READING, "telemetry")
                raise RuntimeError("storage failed")
        self.assertFalse(WebhookDelivery.objects.exists())

    @patch.dict(os.environ, {"HOMEBOT_HERMES_WEBHOOK_URL":"https://receiver.example/hook", "HOMEBOT_HERMES_WEBHOOK_SECRET":"test-secret"})
    @patch("sensors.management.commands.deliver_alerts.send_hermes_alert", side_effect=[False, True])
    def test_failed_delivery_retries_with_same_id(self, send):
        queue_sensor_notifications("unit", {**READING,"changed_sensor":"sound"}, "events")
        row = WebhookDelivery.objects.get()
        self.assertEqual(deliver_pending(), 0)
        row.refresh_from_db()
        self.assertIsNone(row.delivered_at)
        self.assertEqual(row.attempts, 1)
        self.assertGreater(row.next_attempt_at, timezone.now())
        self.assertEqual(deliver_pending(), 0)
        self.assertEqual(send.call_count, 1)
        WebhookDelivery.objects.update(next_attempt_at=timezone.now()-timedelta(seconds=1))
        self.assertEqual(deliver_pending(), 1)
        row.refresh_from_db()
        self.assertIsNotNone(row.delivered_at)
        self.assertEqual(row.attempts, 2)
        self.assertEqual(send.call_args_list[0].kwargs["request_id"], send.call_args_list[1].kwargs["request_id"])
        self.assertEqual(str(row.pk), row.payload["event_id"])

    @patch.dict(os.environ, {"HOMEBOT_HERMES_WEBHOOK_URL":"", "HOMEBOT_HERMES_WEBHOOK_SECRET":""})
    @patch("sensors.management.commands.deliver_alerts.send_hermes_alert")
    def test_missing_settings_does_not_claim_delivery(self, send):
        queue_sensor_notifications("unit", READING, "telemetry")
        self.assertEqual(deliver_pending(), 0)
        self.assertFalse(WebhookDelivery.objects.filter(attempts__gt=0).exists())
        send.assert_not_called()
