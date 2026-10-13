from django.test import TestCase
from django.utils import timezone

from .models import SensorDevice, SoundReading


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
        self.assertEqual(response.json()["devices"][0]["name"], "Sensor de sonido LM393")
        self.assertEqual(response.json()["devices"][0]["pin"], 27)
        self.assertTrue(response.json()["devices"][0]["sound_detected"])
        self.assertTrue(response.json()["devices"][0]["online"])

    def test_readings_returns_recent_sensor_history_in_time_order(self):
        device = SensorDevice.objects.create(device_id="unit-1", name="unit-1")
        SoundReading.objects.create(device=device, sound_detected=False)
        SoundReading.objects.create(device=device, sound_detected=True)

        response = self.client.get("/api/readings/?device=unit-1")

        self.assertEqual(response.status_code, 200)
        points = response.json()["points"]
        self.assertEqual([point["detected"] for point in points], [False, True])
        self.assertEqual([point["value"] for point in points], [0, 1])
        self.assertLessEqual(points[0]["time"], points[1]["time"])

    def test_unknown_device_has_empty_history(self):
        response = self.client.get("/api/readings/?device=not-seen")
        self.assertEqual(response.json(), {"points": [], "device": None})
