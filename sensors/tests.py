from django.test import TestCase
from django.utils import timezone

from .models import LightReading, SensorDevice, SoundReading


class DashboardApiTests(TestCase):
    def test_dashboard_renders(self):
        response = self.client.get("/")

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "Centro de sensores")

    def test_devices_reports_pin_state_and_connection(self):
        SensorDevice.objects.create(
            device_id="esp32-sensores",
            name="Sensor de sonido LM393",
            gpio_pin=27,
            sound_detected=True,
            last_seen=timezone.now(),
        )

        response = self.client.get("/api/devices/")

        self.assertEqual(response.status_code, 200)
        sound = next(item for item in response.json()["devices"] if item["sensor_type"] == "sound")
        light = next(item for item in response.json()["devices"] if item["sensor_type"] == "light")
        self.assertEqual(sound["name"], "Sensor de sonido LM393")
        self.assertEqual(sound["pin"], 27)
        self.assertTrue(sound["detected"])
        self.assertTrue(sound["online"])
        self.assertEqual(light["name"], "Sensor de luz LM393")
        self.assertEqual(light["pin"], 26)

    def test_light_channel_reports_current_state_and_numeric_history(self):
        device = SensorDevice.objects.create(
            device_id="unit-light",
            name="Sensor de sonido LM393",
            light_detected=True,
            last_seen=timezone.now(),
        )
        LightReading.objects.create(device=device, detected=False)
        LightReading.objects.create(device=device, detected=True)

        devices = self.client.get("/api/devices/").json()["devices"]
        light = next(item for item in devices if item["sensor_type"] == "light")
        history = self.client.get(f"/api/readings/?device={light['id']}").json()

        self.assertTrue(light["detected"])
        self.assertEqual([point["value"] for point in history["points"]], [0, 1])

    def test_readings_returns_recent_sensor_history_in_time_order(self):
        device = SensorDevice.objects.create(device_id="unit-1", name="unit-1")
        SoundReading.objects.create(device=device, sound_detected=False)
        SoundReading.objects.create(device=device, sound_detected=True)

        response = self.client.get("/api/readings/?device=unit-1:sound")

        self.assertEqual(response.status_code, 200)
        points = response.json()["points"]
        self.assertEqual([point["detected"] for point in points], [False, True])
        self.assertEqual([point["value"] for point in points], [0, 1])
        self.assertLessEqual(points[0]["time"], points[1]["time"])

    def test_unknown_device_has_empty_history(self):
        response = self.client.get("/api/readings/?device=not-seen:sound")
        self.assertEqual(response.json(), {"points": [], "device": None})
