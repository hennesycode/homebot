# Homebot

Dashboard Django para recibir y visualizar telemetría de sensores ESP32. Mosquitto es el broker MQTT; Django se suscribe a él y almacena las lecturas e historial en MySQL. Cada dispositivo se identifica por el segmento del topic `sensors/<device-id>/telemetry`.

## Inicio con Docker

Requiere Docker Compose v2. Desde esta carpeta:

```sh
cp .env.example .env
```

Edita `.env` y reemplaza todos los valores `replace-with-...`. El servicio MQTT se llama `mqtt` dentro de Compose. Al iniciar, un contenedor de preparación genera el archivo de contraseñas cifradas usando `MQTT_USERNAME` y `MQTT_PASSWORD`; el secreto en texto plano no se guarda en Git.

```sh
docker compose up -d --build
docker compose ps
```

Abre <http://127.0.0.1:8000>. Django aplica las migraciones y recopila archivos estáticos al arrancar; el worker MQTT espera a que MySQL y Django estén listos. Los datos persisten en el volumen Docker `mysql-data`.

MySQL no publica ningún puerto en el host; Django y el worker acceden por la red privada de Compose (`db:3306`). El dashboard se publica únicamente en localhost (`127.0.0.1:8000`). MQTT publica el puerto `1883` para que el ESP32 pueda conectarse; limita su acceso con el firewall. MQTT en `1883` no cifra el tráfico; para producción pública usa TLS (puerto `8883`) y actualiza el firmware del ESP32 para validar el certificado.

```sh
docker compose logs -f web mqtt-worker
docker compose down
```

`docker compose down` conserva los datos. **No uses `docker compose down -v`** si quieres conservar la base de datos.

## Conectar el ESP32

El worker escucha `sensors/+/telemetry`. En el ESP32 configura el dominio/IP de la VPS como `MQTT_HOST`, puerto `1883` y las mismas credenciales MQTT. Asigna un `MQTT_DEVICE_ID` único por placa. Para LM393, el firmware envía `sound_detected` y `sound_pin` (GPIO27).

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
