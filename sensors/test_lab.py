import os
from unittest.mock import patch

from django.test import SimpleTestCase, TestCase

from .serial_bridge import SerialBridge


class LabTests(SimpleTestCase):
    def test_telemetry_and_invalid_reading(self):
        bridge = SerialBridge()
        bridge.consume('{"distance_cm":20.5,"temperature_c":null,"mq2_do_high":true}')
        self.assertEqual(bridge.data["distance_cm"]["value"], 20.5)
        self.assertIsNone(bridge.data["temperature_c"]["value"])
        self.assertEqual(bridge.data["mq2_do_high"]["value"], 1)
        for _ in range(130):
            bridge.consume('{"distance_cm":null}')
        self.assertEqual(len(bridge.histories["distance_cm"]), 120)
        self.assertEqual(len(bridge.logs), 40)

    def test_servo_ack_must_match(self):
        bridge = SerialBridge()
        with self.assertRaises(ValueError):
            bridge.queue_servo(90)
        bridge.pending = {"id": 5}
        bridge.consume("SERVO_ACK 4 90")
        self.assertIsNotNone(bridge.pending)
        bridge.consume("SERVO_ACK 5 90")
        self.assertIsNone(bridge.pending)
        self.assertEqual(bridge.servo["angle"], 90)
        bridge.consume("ESP32 iniciado")
        self.assertIsNone(bridge.servo["angle"])

    @patch.dict(os.environ, {"HOMEBOT_SOURCE": "usb"})
    def test_servo_validation_and_origin(self):
        with patch("sensors.lab_views.bridge.queue_servo") as command:
            for angle in (0, 180, True, "90", None):
                response = self.client.post("/api/lab/servo/", {"angle": angle}, content_type="application/json")
                self.assertEqual(response.status_code, 400)
            response = self.client.post("/api/lab/servo/", {"angle": 90}, content_type="application/json", HTTP_ORIGIN="https://evil.example")
            self.assertEqual(response.status_code, 403)
            command.assert_not_called()
            response = self.client.post("/api/lab/servo/", {"angle": 90}, content_type="application/json")
            self.assertEqual(response.status_code, 202)
            command.assert_called_once_with(90)


class MqttLabTests(TestCase):
    @patch.dict(os.environ, {"HOMEBOT_SOURCE": "mqtt", "HOMEBOT_DEVICE_ID": "unit"})
    def test_remote_snapshot_and_control_disabled(self):
        from .models import SensorDevice, TelemetryReading
        device = SensorDevice.objects.create(device_id="unit", name="ESP32")
        TelemetryReading.objects.create(device=device, payload={"distance_cm": 25.3, "mq2_do_high": False})
        state = self.client.get("/api/lab/").json()
        self.assertTrue(state["online"])
        self.assertEqual(state["source"], "mqtt")
        self.assertEqual(state["data"]["distance_cm"]["value"], 25.3)
        self.assertFalse(state["control_enabled"])
        response = self.client.post("/api/lab/servo/", {"angle": 90}, content_type="application/json")
        self.assertEqual(response.status_code, 403)
