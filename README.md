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

El worker escucha `sensors/+/telemetry`. En el ESP32 configura el dominio/IP de la VPS como `MQTT_HOST`, puerto `1883` y las mismas credenciales MQTT. Asigna un `MQTT_DEVICE_ID` único por placa. Para LM393, el firmware envía `sound_detected` y `sound_pin` (GPIO25 en la configuración actual).

## Alertas a Hermes

Para avisar a Hermes solo cuando un sensor pasa a estado detectado, configura en Dokploy `HOMEBOT_HERMES_WEBHOOK_URL` con la URL HTTPS de la ruta `sensor_alert` creada por Hermes y `HOMEBOT_HERMES_WEBHOOK_SECRET` con el secreto HMAC de esa ruta. El worker firma cada POST con `X-Webhook-Timestamp` y `X-Webhook-Signature-V2`; los secretos no deben guardarse en Git. Despliega de nuevo Homebot después de añadir estas variables.

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

## Laboratorio en vivo (USB local y MQTT remoto)

La página principal muestra siete canales de los cinco sensores: distancia, temperatura,
humedad, MQ-2 AO/DO, sonido y luz. Los niveles digitales no certifican la conexión física
ni la polaridad del módulo. No se calculan PPM y no hay datos de demostración.

Para usar directamente el cable USB en el computador:

```sh
python manage.py migrate
python manage.py collectstatic --noinput
HOMEBOT_SOURCE=usb DJANGO_DEBUG=true python manage.py runserver 127.0.0.1:8000 --noreload
```

Cierra otros monitores seriales. El puente reconoce CP2102 automáticamente; `ESP32_PORT`
permite fijar un puerto. Reconecta cada 2 s, mantiene 120 muestras por canal en memoria
y no necesita Wi-Fi. Ejecuta una sola instancia del servidor USB para evitar propietarios
duplicados del puerto. Las gráficas consultan AJAX cada 0,5–2 s, sin solicitudes solapadas.
El servo admite 45–135° y requiere firmware con el protocolo `SERVO id angle` /
`SERVO_ACK id angle`. La confirmación es del PWM solicitado, no de la posición mecánica.

En la VPS, Compose establece `HOMEBOT_SOURCE=mqtt`; `HOMEBOT_DEVICE_ID` selecciona la placa.
El worker guarda la telemetría completa en `TelemetryReading`, conserva 24 h con limpieza
horaria y el panel grafica las últimas 120 muestras. Los mensajes retenidos no se cuentan
como nueva telemetría. El puerto USB del computador no es accesible desde la VPS.
El control del servo remoto requiere `HOMEBOT_CONTROL_TOKEN`, dominio HTTPS y firmware
con suscripción `sensors/<id>/servo/set`. Por petición del montaje de demostración,
Compose usa `486` si no hay otro valor definido. Este PIN es débil: reemplázalo por
una clave aleatoria larga antes de un uso público continuo. Tras 5 fallos se bloquean
los intentos de control durante 5 minutos (límite compartido por los procesos web).
Configura la variable en Dokploy y vuelve a desplegar; introduce la misma clave en
el campo de control del panel. No se almacena en el navegador ni se entrega en la API.
Las órdenes no se retienen en MQTT; caducan tras 10 s sin confirmación del firmware.
`ServoCommand` registra solicitudes y ACK: publicar no equivale a mover físicamente el eje.
El worker escucha `sensors/+/servo/status`. El control USB sigue disponible en localhost.
El registro remoto muestra las 40 últimas recepciones de telemetría/órdenes MQTT;
no es una copia del monitor serial USB ni incluye mensajes emitidos sin conexión.
Luz se interpreta como LOW = con luz, HIGH = sin luz, según la prueba del montaje actual.
Sonido grafica `sound_detected` (pulso retenido 1 s), no el nivel GPIO instantáneo.
El firmware captura flancos por interrupción y el worker guarda también los eventos
entre telemetrías para no omitirlos en el historial. El MQ-2 DO se lee cada 100 ms y
se interpreta únicamente como alarma del umbral: LOW activa por defecto, configurable
con `HOMEBOT_MQ2_ACTIVE_LOW=false` si se verifica la polaridad contraria. «Sin alarma»
no certifica ausencia de gas; el módulo necesita calentamiento y calibración.
El broker existente en 1883 sigue sin cifrar: usa TLS/8883 y certificados válidos en
ambos extremos antes de exponer MQTT a redes no confiables. La clave HTTPS protege
el endpoint web, pero no cifra el enlace MQTT del ESP32.

Despliegue: hacer pull de `main` y ejecutar `docker compose up -d --build`, o configurar
el despliegue automático de esa rama en Dokploy. El arranque aplica la migración aditiva
0004/0005 sin borrar tablas existentes. Configura el dominio HTTPS hacia el servicio `web:8000`
y `DJANGO_ALLOWED_HOSTS` con el hostname real. Un push por sí solo no demuestra despliegue.
