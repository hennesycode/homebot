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
        result.append({
            "id": device.device_id,
            "name": device.name,
            "pin": device.gpio_pin,
            "sound_detected": device.sound_detected,
            "last_seen": device.last_seen.isoformat() if device.last_seen else None,
            "online": bool(device.last_seen and now - device.last_seen <= timedelta(seconds=15)),
        })
    return JsonResponse({"devices": result})


@require_GET
def readings(request):
    device_id = request.GET.get("device", "")
    device = SensorDevice.objects.filter(device_id=device_id).first()
    if device is None:
        return JsonResponse({"points": [], "device": None})

    points = list(device.readings.order_by("-received_at").values_list("received_at", "sound_detected")[:180])
    points.reverse()
    return JsonResponse({
        "device": device.device_id,
        "points": [{"time": at.isoformat(), "detected": detected} for at, detected in points],
    })
