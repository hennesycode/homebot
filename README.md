# Homebot

Dashboard Django para recibir y visualizar telemetría de sensores ESP32 por MQTT. Cada dispositivo se identifica por el segmento del topic `sensors/<device-id>/telemetry`; las lecturas e historial se guardan en MySQL.

## Inicio con Docker

Requiere Docker Desktop con Docker Compose v2. Desde esta carpeta:

```sh
cp .env.example .env
```

Edita `.env` y reemplaza todos los valores `replace-with-...`. `MQTT_HOST` debe ser la dirección alcanzable del broker (por defecto, un broker en el host con Docker Desktop). Configura `MQTT_USERNAME` y `MQTT_PASSWORD` iguales a los del broker.

```sh
docker compose up -d --build
docker compose ps
```

Abre <http://127.0.0.1:8000>. Django aplica las migraciones y recopila archivos estáticos al arrancar; el worker MQTT espera a que MySQL y Django estén listos. Los datos persisten en el volumen Docker `mysql-data`.

MySQL no publica ningún puerto en el host; Django y el worker acceden por la red privada de Compose (`db:3306`). El dashboard se publica únicamente en localhost (`127.0.0.1:8000`). Para desplegarlo públicamente, usa un proxy HTTPS y agrega autenticación antes de cambiar esa publicación.

```sh
docker compose logs -f web mqtt-worker
docker compose down
```

`docker compose down` conserva los datos. **No uses `docker compose down -v`** si quieres conservar la base de datos.

## Conectar el ESP32

El worker escucha `sensors/+/telemetry`. Configura en el ESP32 el mismo host y credenciales MQTT; asigna un `MQTT_DEVICE_ID` único por placa. Para LM393, el firmware envía `sound_detected` y `sound_pin` (GPIO27).

## Desarrollo local sin Docker

Si `DB_HOST` no está definido, Django usa SQLite para facilitar desarrollo y pruebas:

```sh
python -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver
```

Las variables y contraseñas reales deben permanecer en `.env`; ese archivo está excluido de Git y de la imagen Docker.
