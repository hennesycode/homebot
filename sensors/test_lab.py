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
        bridge.pending = {"id": 5, "angle": 90}
        bridge.consume("SERVO_ACK 4 90")
        self.assertIsNotNone(bridge.pending)
        bridge.consume("SERVO_ACK 5 91")
        self.assertIsNotNone(bridge.pending)
        bridge.consume("SERVO_ACK 5 90")
        self.assertIsNone(bridge.pending)
        self.assertEqual(bridge.servo["angle"], 90)
        bridge.consume("ESP32 iniciado")
        self.assertIsNone(bridge.servo["angle"])

    @patch.dict(os.environ, {"HOMEBOT_SOURCE": "usb"})
    def test_servo_validation_and_origin(self):
        with patch("sensors.lab_views.bridge.queue_servo") as command:
            for angle in (-1, 181, True, "90", None):
                response = self.client.post("/api/lab/servo/", {"angle": angle}, content_type="application/json")
                self.assertEqual(response.status_code, 400)
            response = self.client.post("/api/lab/servo/", {"angle": 90}, content_type="application/json", HTTP_ORIGIN="https://evil.example")
            self.assertEqual(response.status_code, 403)
            command.assert_not_called()
            response = self.client.post("/api/lab/servo/", {"angle": 90}, content_type="application/json")
            self.assertEqual(response.status_code, 202)
            command.assert_called_once_with(90)

    @patch.dict(os.environ, {"HOMEBOT_SOURCE": "usb"})
    def test_full_nominal_servo_range(self):
        from .servo_contract import servo_state
        with patch("sensors.lab_views.bridge.queue_servo") as command:
            for angle, pulse in ((0,1000),(90,1500),(180,2000)):
                response=self.client.post('/api/lab/servo/', {'angle':angle}, content_type='application/json')
                self.assertEqual(response.status_code,202)
                self.assertEqual(servo_state({'angle':angle})['pulse_us'],pulse)
                command.assert_called_with(angle)


class MqttLabTests(TestCase):
    @patch("sensors.management.commands.mqtt_listener.send_hermes_alert")
    @patch("sensors.management.commands.mqtt_listener.mqtt.Client")
    def test_transient_sound_events_are_saved(self, mqtt_client, alert):
        import json
        from types import SimpleNamespace
        from .management.commands.mqtt_listener import Command
        from .models import TelemetryReading
        client = mqtt_client.return_value
        client.loop_forever.side_effect = StopIteration
        with self.assertRaises(StopIteration):
            Command().handle()
        for active in (True, False):
            client.on_message(client, None, SimpleNamespace(
                topic="sensors/unit/events", retain=False,
                payload=json.dumps({"sound_detected":active,"sound_gpio_high":True,
                                    "changed_sensor":"sound"}).encode()))
        values = list(TelemetryReading.objects.order_by("received_at").values_list("payload",flat=True))
        self.assertEqual([v["sound_detected"] for v in values], [True,False])
        self.assertEqual([v["sound_gpio_high"] for v in values], [True,True])

    @patch.dict(os.environ, {"HOMEBOT_CONTROL_TOKEN": "486"})
    def test_pin_throttle_and_reset(self):
        from .lab_views import authorize_servo
        from .models import ServoAccessGuard
        from django.utils import timezone
        from datetime import timedelta
        self.assertEqual(authorize_servo("Bearer wrong", "486").status_code, 403)
        self.assertIsNone(authorize_servo("Bearer 486", "486"))
        self.assertEqual(ServoAccessGuard.objects.get().failures, 0)
        for _ in range(5):
            self.assertEqual(authorize_servo("Bearer wrong", "486").status_code, 403)
        self.assertEqual(authorize_servo("Bearer 486", "486").status_code, 429)
        ServoAccessGuard.objects.update(blocked_until=timezone.now()-timedelta(seconds=1))
        self.assertIsNone(authorize_servo("Bearer 486", "486"))

    def test_full_range_ack_and_pwm_failure(self):
        import json
        from .models import ServoCommand
        from .management.commands.mqtt_listener import store_servo_ack
        for angle in (0,180):
            command=ServoCommand.objects.create(device_id='unit',angle=angle)
            self.assertEqual(store_servo_ack('unit',json.dumps({'id':command.pk,'angle':angle})),1)
            command.refresh_from_db()
            self.assertEqual(command.status,'confirmed')
        command=ServoCommand.objects.create(device_id='unit',angle=90)
        self.assertEqual(store_servo_ack('unit',json.dumps({'id':command.pk,'error':'pwm_unavailable'})),1)
        command.refresh_from_db()
        self.assertEqual(command.status,'failed')

    @patch.dict(os.environ, {'HOMEBOT_SOURCE':'mqtt','HOMEBOT_DEVICE_ID':'unit','HOMEBOT_CONTROL_TOKEN':'486'})
    @patch('sensors.lab_views.publish_servo')
    def test_old_firmware_rejects_extremes_until_usb_update(self, publish):
        from .models import SensorDevice, TelemetryReading
        device=SensorDevice.objects.create(device_id='unit',name='ESP32')
        row=TelemetryReading.objects.create(device=device,payload={'distance_cm':20})
        headers={'HTTP_ORIGIN':'https://testserver','HTTP_AUTHORIZATION':'Bearer 486'}
        response=self.client.post('/api/lab/servo/',{'angle':180},content_type='application/json',**headers)
        self.assertEqual(response.status_code,409)
        publish.assert_not_called()
        state=self.client.get('/api/lab/').json()
        self.assertEqual(state['servo']['max_angle'],135)
        row.payload={'distance_cm':20,'servo_min_angle':0,'servo_max_angle':180,'servo_ready':True}
        row.save()
        response=self.client.post('/api/lab/servo/',{'angle':180},content_type='application/json',**headers)
        self.assertEqual(response.status_code,202)
        publish.assert_called_once()

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
        self.assertTrue(state["logs"])
        self.assertIn("Telemetría MQTT", state["logs"][0]["text"])
        response = self.client.post("/api/lab/servo/", {"angle": 90}, content_type="application/json")
        self.assertEqual(response.status_code, 403)

    @patch.dict(os.environ, {"HOMEBOT_SOURCE": "mqtt", "HOMEBOT_DEVICE_ID": "unit", "HOMEBOT_CONTROL_TOKEN": "x"*32})
    @patch("sensors.lab_views.publish_servo")
    def test_remote_authorization_and_firmware_confirmation(self, publish):
        import json
        from .models import SensorDevice, ServoCommand, TelemetryReading
        from .management.commands.mqtt_listener import store_servo_ack
        device = SensorDevice.objects.create(device_id="unit", name="ESP32")
        TelemetryReading.objects.create(device=device, payload={"distance_cm": 25})
        headers = {"HTTP_ORIGIN": "https://testserver", "HTTP_AUTHORIZATION": "Bearer " + "x"*32}
        missing = self.client.post("/api/lab/servo/", {"angle":90}, content_type="application/json", HTTP_ORIGIN="https://testserver")
        self.assertEqual(missing.status_code, 403)
        response = self.client.post("/api/lab/servo/", {"angle":90}, content_type="application/json", **headers)
        self.assertEqual(response.status_code, 202)
        command = ServoCommand.objects.get(pk=response.json()["command_id"])
        publish.assert_called_once()
        self.assertTrue(self.client.get("/api/lab/").json()["pending"])
        duplicate = self.client.post("/api/lab/servo/", {"angle":90}, content_type="application/json", **headers)
        self.assertEqual(duplicate.status_code, 409)
        self.assertEqual(store_servo_ack("other", json.dumps({"id":command.pk,"angle":90})), 0)
        self.assertEqual(store_servo_ack("unit", json.dumps({"id":command.pk,"angle":91})), 0)
        self.assertEqual(store_servo_ack("unit", json.dumps({"id":command.pk,"angle":90})), 1)
        snapshot = self.client.get("/api/lab/").json()
        self.assertFalse(snapshot["pending"])
        self.assertEqual(snapshot["servo"]["angle"], 90)

    @patch.dict(os.environ, {"HOMEBOT_SOURCE": "mqtt", "HOMEBOT_DEVICE_ID": "unit", "HOMEBOT_CONTROL_TOKEN": "x"*32})
    @patch("sensors.lab_views.publish_servo", side_effect=TimeoutError)
    def test_remote_broker_failure_is_not_confirmation(self, publish):
        from .models import SensorDevice, ServoCommand, TelemetryReading
        device = SensorDevice.objects.create(device_id="unit", name="ESP32")
        TelemetryReading.objects.create(device=device, payload={"distance_cm": 25})
        response = self.client.post("/api/lab/servo/", {"angle":90}, content_type="application/json",
                                    HTTP_ORIGIN="https://testserver", HTTP_AUTHORIZATION="Bearer "+"x"*32)
        self.assertEqual(response.status_code, 502)
        self.assertEqual(ServoCommand.objects.get().status, "failed")
