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

Configura en Dokploy `HOMEBOT_HERMES_WEBHOOK_URL` con la URL HTTPS de la ruta `sensor_alert`
de Hermes y `HOMEBOT_HERMES_WEBHOOK_SECRET` con el secreto HMAC. Redespliega también el
servicio `webhook-worker`. Cada POST incluye `X-Webhook-Timestamp`, `X-Webhook-Signature-V2`
y un `X-Request-ID` estable para que el receptor pueda deduplicar reintentos.

Se encolan lecturas de los cinco sensores cada 30 s (`HOMEBOT_SENSOR_REPORT_SECONDS`,
mínimo 5): HC-SR04, DHT11 con temperatura/humedad, MQ-2 con AO/DO, sonido y luz.
Además se encolan cambios de sonido/luz/MQ-2 (activación y desactivación), eventos del
sensor de humo legado y confirmaciones PWM del servo. Los datos inválidos se notifican
como `state=unavailable`, no como cero. El MQ-2 se marca `uncalibrated`, sin PPM ni afirmar
ausencia de gas. Se conserva el sobre `event_type=sensor_alert` y el objeto `sensor`;
el receptor debe aceptar también `state=reading/clear/unavailable/uncalibrated/pwm_confirmed`.

`WebhookDelivery` persiste los mensajes en la misma transacción que la recepción MQTT.
`python manage.py deliver_alerts` reintenta entregas fallidas con espera creciente hasta
5 minutos; `--once` realiza una pasada. Sin configuración se conservan pendientes y se
avisa en logs. Solo HTTP 2xx marca aceptación; los pendientes no se purgan, los aceptados
se conservan 7 días. `/api/lab/` expone `webhook_delivery.pending` y `last_http_ack`.
La entrega es al menos una vez después de guardar en Homebot: el receptor debe deduplicar
por `event_id` y la respuesta HTTP no garantiza que Pao haya procesado o mostrado el aviso.
No se garantizan muestras perdidas antes de llegar a MQTT/Homebot ni el estado físico del sensor.

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
El servo admite 0–180° nominales (1000–2000 µs a 50 Hz) y requiere firmware con el protocolo `SERVO id angle` /
`SERVO_ACK id angle`. La confirmación es del PWM solicitado, no de la posición mecánica.
El firmware prepara LEDC a 50 Hz y no hace barridos ni centra automáticamente al arrancar.
Se comprueba la inicialización PWM y se informa `servo_ready` en telemetría. Web, USB,
MQTT y Physics Lab usan el mismo rango nominal y rechazan ángulos fuera de 0–180°.
Los extremos necesitan confirmar el recorrido libre; no equivalen a un ángulo mecánico calibrado.
Si el ESP32 sigue enviando telemetría sin capacidades `servo_min_angle`/`servo_max_angle`,
se conserva el rango compatible 45–135°: hay que conectar USB y cargar el firmware nuevo
antes de habilitar los extremos. La web no puede actualizar por Wi-Fi un firmware sin OTA.
Si un ACK correcto no produce movimiento, verifica con el servo sin carga: rojo a 5 V
regulados con corriente suficiente (preferiblemente fuente dedicada de al menos 1 A),
café a GND común y naranja a GPIO23. Mide rojo/café bajo carga, no desde el propio GPIO.
No unas una fuente externa de 5 V al USB sin protección contra alimentación inversa.
Si zumba o se atasca, corta la alimentación. No fuerces topes ni amplíes automáticamente
a 500–2500 µs: `SERVO_MIN_PULSE_US`/`SERVO_MAX_PULSE_US` requieren calibración supervisada.

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

## Physics Lab 3D (módulo independiente)

Acceso en `/physics/` y desde el enlace añadido al final del dashboard. No modifica
firmware, controles, webhooks ni adquisición. `/api/physics/telemetry/` es un adaptador
GET de los mismos servicios USB/MQTT: añade historial de ACK confirmados del servo,
sin abrir otra conexión serial ni otro suscriptor MQTT.

- Montaje CSS 3D con seis componentes, giro/zoom, señales conceptuales y valores vigentes.
- Física aplicada: transducción, fotoconductividad, SnO₂, humedad y motor electromagnético.
- Circuitos: divisores, V=IR, Rth y modelo MQ-2; entradas ajustables, siempre teóricas.
- Analizador: historial y estados, no osciloscopio. ECHO se infiere de d redondeada a
  343 m/s; v(T)=331,3+0,606T es una compensación didáctica, no una nueva medida.
- Experimentos A–D: registro de hasta 600 muestras/10 min, media, extremos, σ y error
  frente a referencia. Se conservan timestamps por canal y eventos intermedios disponibles.
- Sesiones en IndexedDB de este navegador; reproducción no actúa sobre el hardware.
  Exporta JSON, CSV o informe HTML con gráfica y ecuaciones. No hay sincronización cloud.

Datos reales, simulación y reproducción están rotulados. Cambiar sliders no mueve el
servo: solo el botón explícito de envío, con confirmación del visitante y la autorización
existente, puede enviar una orden de 0–180° nominales. No se afirman lux, PPM, corriente, campo
magnético, seguridad de voltajes ni posición real del eje sin sensores adicionales.
Las animaciones describen conceptos; no generan mediciones nuevas ni prueban causalidad.

Validación adicional: `node --test sensors/test_physics_math.cjs` y
`python manage.py test sensors.test_physics`. Los recursos son locales, sin librerías 3D
ni CDN: se publican con el `collectstatic` existente. No requiere migración de base de datos.
