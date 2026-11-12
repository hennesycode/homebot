import os

from django.http import JsonResponse
from django.shortcuts import render
from django.views.decorators.http import require_GET

from .lab_views import mqtt_snapshot
from .models import ServoCommand
from .serial_bridge import bridge


@require_GET
def physics_lab(request):
    return render(request, "sensors/physics.html")


@require_GET
def telemetry(request):
    """Read-only adapter: reuse acquisition, add actual servo ACK timestamps for replay."""
    if os.getenv('HOMEBOT_SOURCE', 'mqtt') == 'usb':
        data = bridge.snapshot()
        data.update(source='usb', control_enabled=True)
    else:
        data = mqtt_snapshot()
        commands = list(ServoCommand.objects.filter(
            device_id=os.getenv('HOMEBOT_DEVICE_ID', 'esp32-sensores'),
            status='confirmed', confirmed_at__isnull=False).order_by('-confirmed_at')[:120])
        commands.reverse()
        data['histories']['servo_angle'] = [[c.confirmed_at.timestamp(), c.angle] for c in commands]
        if commands:
            last = commands[-1]
            data['data']['servo_angle'] = {'value': last.angle, 'at': last.confirmed_at.timestamp()}
    data['mq2_active_low'] = os.getenv('HOMEBOT_MQ2_ACTIVE_LOW', 'true').lower() == 'true'
    response = JsonResponse(data)
    response['Cache-Control'] = 'no-store'
    return response
