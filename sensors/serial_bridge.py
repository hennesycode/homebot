"""One local USB owner; bounded history, reconnects and acknowledged servo commands."""
import copy
import json
import math
import os
import re
import threading
import time
from collections import deque

import serial
from serial.tools import list_ports


class SerialBridge:
    def __init__(self):
        self.lock = threading.RLock()
        self.started = False
        self.connected = False
        self.port = None
        self.error = "Esperando conexión USB"
        self.last_seen = 0
        self.data = {}
        self.histories = {}
        self.logs = deque(maxlen=40)
        self.pending = None
        self.command_id = 0
        self.servo = {"angle": None, "status": "Sin confirmación PWM"}

    def start(self):
        with self.lock:
            if not self.started:
                self.started = True
                threading.Thread(target=self.run, daemon=True, name="esp32-usb").start()

    def record(self, key, value, now):
        if value is not None and (isinstance(value, bool) or
                                  isinstance(value, (int, float)) and math.isfinite(value)):
            value = float(value)
        else:
            value = None
        self.data[key] = {"value": value, "at": now}
        self.histories.setdefault(key, deque(maxlen=120)).append([now, value])

    def consume(self, line):
        now = time.time()
        with self.lock:
            self.logs.append({"at": now, "text": line[:1000]})
            if line == "ESP32 iniciado":
                self.data.clear()
                self.servo = {"angle": None, "status": "ESP32 reiniciado"}
                self.pending = None
            distance = re.fullmatch(r"Distancia: (\d+(?:\.\d+)?) cm \(ECHO \d+ us\)", line)
            if distance:
                self.record("distance_cm", float(distance[1]), now)
            elif line.startswith("HC-SR04: sin eco") or line.startswith("HC-SR04: fuera de rango"):
                self.record("distance_cm", None, now)
            analog = re.fullmatch(r"MQ-2 AO GPIO34: ADC=(\d+)/4095 .*", line)
            if analog:
                self.record("mq2_ao_raw", int(analog[1]), now)
            digital = re.match(r"(Sonido GPIO25|Luz GPIO26|MQ-2 DO GPIO27): (HIGH|LOW)", line)
            if digital:
                key = {"Sonido GPIO25": "sound_gpio_high", "Luz GPIO26": "light_gpio_high",
                       "MQ-2 DO GPIO27": "mq2_do_high"}[digital[1]]
                self.record(key, digital[2] == "HIGH", now)
            if line.startswith("{"):
                try:
                    data = json.loads(line)
                except (ValueError, TypeError):
                    return
                if not isinstance(data, dict) or "distance_cm" not in data:
                    return
                for key in ("distance_cm", "temperature_c", "humidity_pct", "sound_gpio_high",
                            "light_gpio_high", "mq2_do_high", "mq2_ao_raw"):
                    if key in data:
                        self.record(key, data[key], now)
                self.last_seen = now
            match = re.fullmatch(r"SERVO_ACK (\d+) (\d+)", line)
            if match and self.pending and int(match[1]) == self.pending["id"]:
                self.servo = {"angle": int(match[2]), "status": "Orden PWM confirmada"}
                self.record("servo_angle", int(match[2]), now)
                self.pending = None

    def snapshot(self):
        self.start()
        with self.lock:
            now = time.time()
            return copy.deepcopy({
                "usb": self.connected, "online": self.connected and now - self.last_seen < 6,
                "port": self.port, "error": self.error, "last_seen": self.last_seen,
                "data": self.data, "histories": {k: list(v) for k, v in self.histories.items()},
                "logs": list(self.logs), "servo": self.servo,
                "pending": self.pending is not None, "now": now,
            })

    def queue_servo(self, angle):
        with self.lock:
            if not self.connected or time.time() - self.last_seen >= 6:
                raise ValueError("ESP32 sin telemetría reciente")
            if self.pending:
                raise ValueError("Espera la confirmación de la orden anterior")
            self.command_id = (self.command_id + 1) % 1000000
            self.pending = {"id": self.command_id, "angle": angle, "sent": False,
                            "deadline": time.monotonic() + 5}
            self.servo["status"] = "Esperando confirmación"

    def run(self):
        while True:
            try:
                configured = os.getenv("ESP32_PORT")
                ports = [p.device for p in list_ports.comports() if p.vid == 0x10C4 and p.pid == 0xEA60]
                port = configured or (ports[0] if ports else None)
                if not port:
                    raise serial.SerialException("Conecta el ESP32 mediante USB")
                device = serial.Serial()
                device.port, device.baudrate = port, 115200
                device.timeout, device.write_timeout = 0.2, 1
                device.dtr = device.rts = False
                with device:
                    with self.lock:
                        self.connected, self.port, self.error = True, port, None
                    buffer = b""
                    while True:
                        chunk = device.read(2048)
                        buffer += chunk
                        while b"\n" in buffer:
                            raw, buffer = buffer.split(b"\n", 1)
                            self.consume(raw.decode("utf-8", errors="replace").strip())
                        if len(buffer) > 8192:
                            buffer = b""
                        with self.lock:
                            if self.pending and time.monotonic() > self.pending["deadline"]:
                                self.pending = None
                                self.servo["status"] = "Sin confirmación: firmware o conexión"
                            if self.pending and not self.pending["sent"]:
                                command = self.pending
                                device.write(f'SERVO {command["id"]} {command["angle"]}\n'.encode())
                                command["sent"] = True
            except (serial.SerialException, OSError) as exc:
                with self.lock:
                    self.connected = False
                    self.error = str(exc)
                    self.pending = None
                    self.servo["status"] = "USB desconectado"
                time.sleep(2)


bridge = SerialBridge()
