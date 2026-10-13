const deviceGrid = document.querySelector('#device-grid');
const chartLine = document.querySelector('#chart-line');
const chartArea = document.querySelector('#chart-area');
const chartPoint = document.querySelector('#chart-point');
const chartEmpty = document.querySelector('#chart-empty');
const banner = document.querySelector('#reading-banner');
let selectedDevice = null;
let devices = [];

const formatTime = (value) => new Date(value).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

function renderChart(points) {
  const valid = points.filter((point) => point.time);
  chartEmpty.hidden = valid.length > 0;
  chartLine.setAttribute('d', '');
  chartArea.setAttribute('d', '');
  chartPoint.setAttribute('r', '0');
  if (!valid.length) {
    document.querySelector('#range-start').textContent = '—';
    document.querySelector('#range-end').textContent = '—';
    return;
  }

  const width = 900;
  const top = 36;
  const bottom = 184;
  const step = width / Math.max(valid.length - 1, 1);
  let path = `M 0 ${valid[0].detected ? top : bottom}`;
  valid.forEach((point, index) => {
    const x = index * step;
    const y = point.detected ? top : bottom;
    if (index) path += ` H ${x}`;
    path += ` V ${y}`;
  });
  const lastX = (valid.length - 1) * step;
  const lastY = valid.at(-1).detected ? top : bottom;
  chartLine.setAttribute('d', path);
  chartArea.setAttribute('d', `${path} L ${lastX} 205 L 0 205 Z`);
  chartPoint.setAttribute('cx', String(lastX));
  chartPoint.setAttribute('cy', String(lastY));
  chartPoint.setAttribute('r', '4');
  document.querySelector('#range-start').textContent = formatTime(valid[0].time);
  document.querySelector('#range-end').textContent = formatTime(valid.at(-1).time);

  const current = valid.at(-1);
  banner.classList.toggle('detected', current.detected);
  document.querySelector('#reading-state').textContent = current.detected ? 'Sonido detectado' : 'Sin sonido';
  document.querySelector('#reading-value').textContent = current.detected ? '1' : '0';
}

function renderDevices() {
  document.querySelector('#device-total').textContent = devices.length;
  document.querySelector('#device-online').textContent = devices.filter((device) => device.online).length;
  document.querySelector('#sound-total').textContent = devices.filter((device) => device.sound_detected).length;
  document.querySelector('#nav-count').textContent = devices.length;
  document.querySelector('#device-status').textContent = devices.length ? `${devices.length} dispositivo${devices.length === 1 ? '' : 's'} detectado${devices.length === 1 ? '' : 's'}` : 'Sin dispositivos todavía';
  const brokerOnline = devices.some((device) => device.online);
  document.querySelector('#broker-dot').classList.toggle('online', brokerOnline);
  document.querySelector('#broker-state').textContent = brokerOnline ? 'Señal MQTT recibida' : 'Esperando señal MQTT';

  if (!devices.length) {
    deviceGrid.innerHTML = '<div class="empty-device"><span class="empty-wave" aria-hidden="true">⌁</span><div><strong>Esperando el primer sensor</strong><p>Cuando llegue un mensaje MQTT aparecerá aquí con su pin y estado.</p></div></div>';
    selectedDevice = null;
    document.querySelector('#chart-device').textContent = 'Selecciona un dispositivo para ver sus lecturas';
    document.querySelector('#reading-pin').textContent = 'GPIO —';
    renderChart([]);
    return;
  }

  if (!devices.some((device) => device.id === selectedDevice)) selectedDevice = devices[0].id;
  deviceGrid.replaceChildren(...devices.map((device) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `device-card${device.id === selectedDevice ? ' selected' : ''}`;
    button.setAttribute('aria-pressed', String(device.id === selectedDevice));
    const top = document.createElement('span');
    top.className = 'device-top';
    const title = document.createElement('span');
    title.className = 'device-title';
    const name = document.createElement('span');
    name.className = 'device-name';
    name.textContent = device.name;
    const id = document.createElement('span');
    id.className = 'device-id';
    id.textContent = device.id;
    title.append(name, id);
    const state = document.createElement('span');
    state.className = `device-state${device.online ? ' online' : ''}`;
    const stateDot = document.createElement('i');
    const stateText = document.createElement('span');
    stateText.textContent = device.online ? 'Conectado' : 'Desconectado';
    state.append(stateDot, stateText);
    top.append(title, state);
    const bottom = document.createElement('span');
    bottom.className = 'device-bottom';
    const pin = document.createElement('span');
    pin.className = 'device-pin';
    pin.textContent = `LM393 · GPIO ${device.pin}`;
    const reading = document.createElement('span');
    reading.className = `device-reading ${device.sound_detected ? 'detected' : 'quiet'}`;
    reading.textContent = device.sound_detected ? 'Sonido · 1' : 'Silencio · 0';
    bottom.append(pin, reading);
    button.append(top, bottom);
    button.addEventListener('click', () => {
      selectedDevice = device.id;
      renderDevices();
      refreshReadings();
    });
    return button;
  }));

  const selected = devices.find((device) => device.id === selectedDevice);
  document.querySelector('#chart-device').textContent = `${selected.name} · ${selected.id}`;
  document.querySelector('#reading-pin').textContent = `GPIO ${selected.pin}`;
  banner.classList.toggle('detected', selected.sound_detected);
  document.querySelector('#reading-state').textContent = selected.sound_detected ? 'Sonido detectado' : 'Sin sonido';
  document.querySelector('#reading-value').textContent = selected.sound_detected ? '1' : '0';
}

async function refreshReadings() {
  if (!selectedDevice) return;
  try {
    const response = await fetch(`/api/readings/?device=${encodeURIComponent(selectedDevice)}`, { cache: 'no-store' });
    if (!response.ok) throw new Error('No se pudo consultar el historial');
    const data = await response.json();
    if (data.device === selectedDevice) renderChart(data.points);
  } catch {
    document.querySelector('#updated-at').textContent = 'Error al actualizar lecturas';
  }
}

async function refreshDevices() {
  try {
    const response = await fetch('/api/devices/', { cache: 'no-store' });
    if (!response.ok) throw new Error('No se pudo consultar el sistema');
    const data = await response.json();
    devices = data.devices;
    renderDevices();
    await refreshReadings();
    document.querySelector('#updated-at').textContent = `Última actualización ${new Date().toLocaleTimeString('es-MX')}`;
  } catch {
    document.querySelector('#updated-at').textContent = 'No se pudo conectar con Homebot';
  }
}

function updateClock() {
  document.querySelector('#clock').textContent = new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

updateClock();
refreshDevices();
setInterval(updateClock, 1000);
setInterval(refreshDevices, 1500);
