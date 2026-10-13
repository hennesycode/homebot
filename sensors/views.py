from datetime import timedelta

from django.http import JsonResponse
from django.shortcuts import render
from django.utils import timezone
from django.views.decorators.http import require_GET

from .models import SensorDevice


@require_GET
def dashboard(request):
    return render(request, "sensors/dashboard.html")


@require_GET
def devices(request):
    now = timezone.now()
    result = []
    for device in SensorDevice.objects.order_by("name"):
        online = bool(device.last_seen and now - device.last_seen <= timedelta(seconds=15))
        last_seen = device.last_seen.isoformat() if device.last_seen else None
        result.extend([
            {
                "id": f"{device.device_id}:sound",
                "device_id": device.device_id,
                "name": device.name,
                "sensor_type": "sound",
                "pin": device.gpio_pin,
                "detected": device.sound_detected,
                "last_seen": last_seen,
                "online": online,
            },
            {
                "id": f"{device.device_id}:light",
                "device_id": device.device_id,
                "name": "Sensor de luz LM393",
                "sensor_type": "light",
                "pin": device.light_gpio_pin,
                "detected": device.light_detected,
                "last_seen": last_seen,
                "online": online,
            },
        ])
    return JsonResponse({"devices": result})


@require_GET
def readings(request):
    channel_id = request.GET.get("device", "")
    device_id, separator, sensor_type = channel_id.rpartition(":")
    if not separator or sensor_type not in ("sound", "light"):
        return JsonResponse({"points": [], "device": None})
    device = SensorDevice.objects.filter(device_id=device_id).first()
    if device is None:
        return JsonResponse({"points": [], "device": None})

    history = device.readings if sensor_type == "sound" else device.light_readings
    values = history.order_by("-received_at").values_list(
        "received_at", "sound_detected" if sensor_type == "sound" else "detected"
    )[:180]
    points = list(values)
    points.reverse()
    return JsonResponse({
        "device": channel_id,
        "points": [
            {"time": at.isoformat(), "detected": detected, "value": int(detected)}
            for at, detected in points
        ],
    })
