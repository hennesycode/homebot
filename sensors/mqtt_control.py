import os
import time

import paho.mqtt.client as mqtt


def publish_servo(command):
    """Publish without retention, with a bounded connection/acknowledgement wait."""
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
    client.connect_timeout = 3
    client.username_pw_set(os.getenv("MQTT_USERNAME", ""), os.getenv("MQTT_PASSWORD", ""))
    if os.getenv("MQTT_TLS", "false").lower() == "true":
        client.tls_set()
    deadline = time.monotonic() + 4
    try:
        client.connect(os.getenv("MQTT_HOST", "localhost"), int(os.getenv("MQTT_PORT", "1883")), 15)
        while not client.is_connected() and time.monotonic() < deadline:
            client.loop(timeout=0.1)
        if not client.is_connected():
            raise TimeoutError("Broker sin conexión")
        message = client.publish(f"sensors/{command.device_id}/servo/set",
                                 f"{command.pk} {command.angle}", qos=1, retain=False)
        while not message.is_published() and time.monotonic() < deadline:
            client.loop(timeout=0.1)
        if not message.is_published():
            raise TimeoutError("Broker no confirmó la publicación")
    finally:
        client.disconnect()
