import json
import math
import os
import secrets
import time
from datetime import timedelta
from urllib.parse import urlparse

from django.http import JsonResponse
from django.db import transaction
from django.utils import timezone
from django.views.decorators.http import require_GET, require_POST

from .serial_bridge import bridge
from .models import SensorDevice, ServoAccessGuard, ServoCommand, TelemetryReading, WebhookDelivery
from .mqtt_control import publish_servo


@require_GET
def state(request):
    if os.getenv("HOMEBOT_SOURCE", "mqtt") == "usb":
        data = bridge.snapshot()
        data["source"] = "usb"
        data["control_enabled"] = True
    else:
        data = mqtt_snapshot()
    data["mq2_active_low"] = os.getenv("HOMEBOT_MQ2_ACTIVE_LOW", "true").lower() == "true"
    deliveries = WebhookDelivery.objects.filter(device_id=os.getenv("HOMEBOT_DEVICE_ID", "esp32-sensores"))
    last_ack = deliveries.filter(delivered_at__isnull=False).order_by("-delivered_at").first()
    data["webhook_delivery"] = {
        "pending": deliveries.filter(delivered_at__isnull=True).exists(),
        "last_http_ack": last_ack.delivered_at.isoformat() if last_ack else None,
        "note": "HTTP aceptado no confirma que Pao haya procesado el mensaje",
    }
    response = JsonResponse(data)
    response["Cache-Control"] = "no-store"
    return response


@require_POST
def servo(request):
    remote = os.getenv("HOMEBOT_SOURCE", "mqtt") != "usb"
    origin = request.headers.get("Origin")
    if remote:
        token = os.getenv("HOMEBOT_CONTROL_TOKEN", "")
        if len(token) < 3:
            return JsonResponse({"error": "Configura HOMEBOT_CONTROL_TOKEN en el servidor"}, status=403)
        if not origin or urlparse(origin).scheme != "https" or urlparse(origin).netloc != request.get_host():
            return JsonResponse({"error": "Control remoto requiere el mismo dominio HTTPS"}, status=403)
        error = authorize_servo(request.headers.get("Authorization", ""), token)
        if error:
            return error
    elif (request.META.get("REMOTE_ADDR") not in ("127.0.0.1", "::1") or
          origin and urlparse(origin).netloc != request.get_host()):
        return JsonResponse({"error": "Control permitido solo desde el servidor local"}, status=403)
    if request.content_type != "application/json" or len(request.body) > 256:
        return JsonResponse({"error": "Se requiere JSON"}, status=400)
    try:
        data = json.loads(request.body)
        angle = data.get("angle") if isinstance(data, dict) else None
        if type(angle) is not int or not 45 <= angle <= 135:
            return JsonResponse({"error": "Ángulo entero entre 45 y 135°"}, status=400)
        if remote:
            return remote_servo(angle)
        bridge.queue_servo(angle)
    except (ValueError, UnicodeDecodeError) as exc:
        return JsonResponse({"error": str(exc)}, status=409)
    return JsonResponse({"queued": True}, status=202)


def authorize_servo(authorization, token):
    # Global database-backed limit also applies across web workers and client IPs.
    now = timezone.now()
    with transaction.atomic():
        guard, _ = ServoAccessGuard.objects.select_for_update().get_or_create(key="servo")
        if guard.blocked_until and guard.blocked_until > now:
            return JsonResponse({"error": "Demasiados intentos. Espera 5 minutos."}, status=429)
        valid = secrets.compare_digest(authorization.encode(), f"Bearer {token}".encode())
        guard.failures = 0 if valid else guard.failures + 1
        guard.blocked_until = None
        if guard.failures >= 5:
            guard.failures = 0
            guard.blocked_until = now + timedelta(minutes=5)
        guard.save()
        if not valid:
            return JsonResponse({"error": "Clave de control incorrecta"}, status=403)
    return None


def remote_servo(angle):
    device_id = os.getenv("HOMEBOT_DEVICE_ID", "esp32-sensores")
    cutoff = timezone.now() - timedelta(seconds=10)
    if not TelemetryReading.objects.filter(device_id=device_id, received_at__gte=cutoff).exists():
        return JsonResponse({"error": "ESP32 sin telemetría reciente"}, status=409)
    with transaction.atomic():
        # Serialize commands across web workers; old pending requests expire after 10 s.
        SensorDevice.objects.select_for_update().get(pk=device_id)
        ServoCommand.objects.filter(device_id=device_id, status="pending", created_at__lt=cutoff).update(status="timeout")
        if ServoCommand.objects.filter(device_id=device_id, status="pending").exists():
            return JsonResponse({"error": "Espera la confirmación de la orden anterior"}, status=409)
        command = ServoCommand.objects.create(device_id=device_id, angle=angle)
    try:
        publish_servo(command)
    except (OSError, ValueError, TimeoutError, RuntimeError):
        ServoCommand.objects.filter(pk=command.pk, status="pending").update(status="failed")
        return JsonResponse({"error": "No se pudo enviar al broker MQTT"}, status=502)
    return JsonResponse({"queued": True, "command_id": command.pk}, status=202)


def mqtt_snapshot():
    now = time.time()
    device_id = os.getenv("HOMEBOT_DEVICE_ID", "esp32-sensores")
    rows = list(TelemetryReading.objects.filter(device_id=device_id).order_by("-received_at")[:120])
    rows.reverse()
    histories, data = {}, {}
    keys = ("distance_cm", "temperature_c", "humidity_pct", "sound_gpio_high", "sound_detected",
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
    commands = list(ServoCommand.objects.filter(device_id=device_id).order_by("-created_at")[:20])
    logs = [{"at": row.received_at.timestamp(), "text": "Telemetría MQTT: " + json.dumps(row.payload, ensure_ascii=False)} for row in rows[-40:]]
    command_labels = {"pending": "en espera", "confirmed": "PWM confirmado", "failed": "error de envío", "timeout": "sin confirmación"}
    for command in commands:
        logs.append({"at": (command.confirmed_at or command.created_at).timestamp(),
                     "text": f"Servo #{command.pk}: {command.angle}° · {command_labels.get(command.status, command.status)}"})
    logs.sort(key=lambda item: item["at"])
    latest = commands[0] if commands else None
    confirmed = next((c for c in commands if c.status == "confirmed"), None)
    pending = bool(latest and latest.status == "pending" and now-latest.created_at.timestamp() < 10)
    labels = {"confirmed": "Orden PWM confirmada", "failed": "Error al publicar en MQTT", "timeout": "Sin confirmación del ESP32"}
    status = ("Esperando confirmación MQTT" if pending else
              labels.get(latest.status, "Sin confirmación del ESP32")) if latest else "Listo para control MQTT autorizado"
    configured = len(os.getenv("HOMEBOT_CONTROL_TOKEN", "")) >= 3
    if not configured:
        status = "Falta configurar HOMEBOT_CONTROL_TOKEN en el servidor"
    return {"source": "mqtt", "usb": False, "online": online, "port": f"MQTT / {device_id}",
            "last_seen": last_seen, "now": now, "data": data, "histories": histories,
            "logs": logs[-40:], "pending": pending, "control_enabled": configured,
            "error": None if online else "Sin telemetría MQTT reciente. Comprueba Wi-Fi, broker y mqtt-worker.",
            "servo": {"angle": confirmed.angle if confirmed else None, "status": status}}
