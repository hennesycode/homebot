import json
import math
import os
import time
from urllib.parse import urlparse

from django.http import JsonResponse
from django.views.decorators.http import require_GET, require_POST

from .serial_bridge import bridge
from .models import TelemetryReading


@require_GET
def state(request):
    if os.getenv("HOMEBOT_SOURCE", "mqtt") == "usb":
        data = bridge.snapshot()
        data["source"] = "usb"
        data["control_enabled"] = True
    else:
        data = mqtt_snapshot()
    response = JsonResponse(data)
    response["Cache-Control"] = "no-store"
    return response


@require_POST
def servo(request):
    if os.getenv("HOMEBOT_SOURCE", "mqtt") != "usb":
        return JsonResponse({"error": "Control remoto desactivado: requiere autorización y canal seguro. Usa USB local."}, status=403)
    # Local hardware control only. JSON + same origin prevent cross-site form commands.
    origin = request.headers.get("Origin")
    if (request.META.get("REMOTE_ADDR") not in ("127.0.0.1", "::1") or
            origin and urlparse(origin).netloc != request.get_host()):
        return JsonResponse({"error": "Control permitido solo desde el servidor local"}, status=403)
    if request.content_type != "application/json" or len(request.body) > 256:
        return JsonResponse({"error": "Se requiere JSON"}, status=400)
    try:
        data = json.loads(request.body)
        angle = data.get("angle") if isinstance(data, dict) else None
        if type(angle) is not int or not 45 <= angle <= 135:
            return JsonResponse({"error": "Ángulo entero entre 45 y 135°"}, status=400)
        bridge.queue_servo(angle)
    except (ValueError, UnicodeDecodeError) as exc:
        return JsonResponse({"error": str(exc)}, status=409)
    return JsonResponse({"queued": True}, status=202)


def mqtt_snapshot():
    now = time.time()
    device_id = os.getenv("HOMEBOT_DEVICE_ID", "esp32-sensores")
    rows = list(TelemetryReading.objects.filter(device_id=device_id).order_by("-received_at")[:120])
    rows.reverse()
    histories, data = {}, {}
    keys = ("distance_cm", "temperature_c", "humidity_pct", "sound_gpio_high",
            "light_gpio_high", "mq2_do_high", "mq2_ao_raw")
    for row in rows:
        at = row.received_at.timestamp()
        for key in keys:
            raw = row.payload.get(key)
            value = float(raw) if isinstance(raw, (int, float, bool)) and math.isfinite(raw) else None
            histories.setdefault(key, []).append([at, value])
            data[key] = {"value": value, "at": at}
    last_seen = rows[-1].received_at.timestamp() if rows else 0
    online = now - last_seen < 10
    return {"source": "mqtt", "usb": False, "online": online, "port": f"MQTT / {device_id}",
            "last_seen": last_seen, "now": now, "data": data, "histories": histories,
            "logs": [], "pending": False, "control_enabled": False,
            "error": None if online else "Sin telemetría MQTT reciente. Comprueba Wi-Fi, broker y mqtt-worker.",
            "servo": {"angle": None, "status": "Control disponible solo por USB local (seguridad)"}}
