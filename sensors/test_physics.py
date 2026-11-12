import os
from unittest.mock import patch

from django.test import SimpleTestCase, TestCase, override_settings


@override_settings(STORAGES={
    'default': {'BACKEND': 'django.core.files.storage.FileSystemStorage'},
    'staticfiles': {'BACKEND': 'django.contrib.staticfiles.storage.StaticFilesStorage'},
})
class PhysicsModuleTests(SimpleTestCase):
    def test_separate_page_and_assets(self):
        response = self.client.get('/physics/')
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'Physics Lab 3D')
        self.assertContains(response, 'physics-math.js')
        self.assertContains(response, 'Datos reales')
        self.assertContains(response, 'Simulación')
        self.assertContains(response, 'no es un osciloscopio')
        self.assertContains(response, 'Nunca envía órdenes al servo')

    def test_existing_dashboard_has_only_new_navigation(self):
        response = self.client.get('/')
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'href="/physics/"')
        self.assertContains(response, 'id="send-servo"')
        self.assertContains(response, 'id="sensors"')

    def test_physics_page_is_read_only(self):
        self.assertEqual(self.client.post('/physics/').status_code, 405)


class PhysicsTelemetryTests(TestCase):
    @patch.dict(os.environ, {'HOMEBOT_SOURCE': 'mqtt', 'HOMEBOT_DEVICE_ID': 'physics-unit'})
    def test_reuses_telemetry_and_only_confirmed_servo_history(self):
        from django.utils import timezone
        from .models import SensorDevice, TelemetryReading, ServoCommand
        device = SensorDevice.objects.create(device_id='physics-unit', name='ESP32')
        TelemetryReading.objects.create(device=device, payload={'distance_cm': 20.1, 'sound_detected': True})
        at = timezone.now()
        ServoCommand.objects.create(device_id=device.pk, angle=90, status='confirmed', confirmed_at=at)
        ServoCommand.objects.create(device_id=device.pk, angle=45, status='pending')
        response = self.client.get('/api/physics/telemetry/')
        data = response.json()
        self.assertEqual(data['data']['distance_cm']['value'], 20.1)
        self.assertEqual(data['histories']['servo_angle'], [[at.timestamp(), 90]])
        self.assertEqual(data['data']['servo_angle']['at'], at.timestamp())
        self.assertEqual(response['Cache-Control'], 'no-store')
        self.assertEqual(self.client.post('/api/physics/telemetry/').status_code, 405)
