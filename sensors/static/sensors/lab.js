const channels = [
  {key:'distance_cm', name:'Ultrasónico', pin:'HC-SR04 · TRIG 18 / ECHO 19', unit:'cm', note:'Distancia calculada · cada 500 ms'},
  {key:'temperature_c', name:'Temperatura', pin:'DHT11 · GPIO32', unit:'°C', note:'Muestra DHT11 · cada 2 segundos'},
  {key:'humidity_pct', name:'Humedad', pin:'DHT11 · GPIO32', unit:'% RH', note:'Humedad relativa · cada 2 segundos'},
  {key:'mq2_ao_raw', name:'Gas · salida analógica', pin:'MQ-2 AO · GPIO34 / ADC1', unit:'/ 4095', note:'ADC bruto · no calibrado, no PPM'},
  {key:'mq2_do_high', name:'Gas · salida digital', pin:'MQ-2 DO · GPIO27', unit:'', digital:true, note:'Alarma del umbral · sin calibrar; no certifica ausencia de gas'},
  {key:'sound_detected', name:'Sonido', pin:'OUT · GPIO25', unit:'', digital:true, note:'Pulsos detectados · retención 1 s; no mide decibelios'},
  {key:'light_gpio_high', name:'Luz', pin:'DO · GPIO26', unit:'', digital:true, note:'LOW = con luz · HIGH = sin luz (según prueba del usuario)'}
];
const $ = (id) => document.getElementById(id);
const clock = (at) => new Date(at * 1000).toLocaleTimeString('es', {hour12:false});
let sending = false;
let servoError = '';
let mq2ActiveLow = true;
const servoButtons = () => [$('send-servo'), ...document.querySelectorAll('[data-servo-angle]')];
let servoLimits={min:0,max:180};
function disableServo(disabled) { servoButtons().forEach(button=>{const angle=Number(button.dataset.servoAngle);button.disabled=disabled || button.hasAttribute('data-servo-angle')&&(angle<servoLimits.min||angle>servoLimits.max);}); }

function digitalActive(channel, value) {
  if (channel.key === 'light_gpio_high') return !value;
  if (channel.key === 'mq2_do_high') return mq2ActiveLow ? !value : Boolean(value);
  return Boolean(value);
}

function digitalLabel(channel, value) {
  const active = digitalActive(channel, value);
  if (channel.key === 'light_gpio_high') return active ? 'Con luz' : 'Sin luz';
  if (channel.key === 'sound_detected') return active ? 'Con sonido' : 'Sin sonido';
  return active ? 'Alarma de gas' : 'Sin alarma';
}
channels.forEach(c => {
  const article = document.createElement('article');
  article.className = 'sensor';
  article.innerHTML = `<div class="sensor-head"><h3>${c.name}</h3><span id="status-${c.key}" class="badge">Sin datos</span></div><p class="pin">${c.pin}</p><div class="value"><span id="value-${c.key}">—</span><small>${c.unit}</small></div><p class="sensor-note">${c.note}</p><svg class="spark" viewBox="0 0 300 100" preserveAspectRatio="none" role="img" aria-label="Historial de ${c.name}"><path class="gridline" d="M0 15 H300 M0 50 H300 M0 85 H300"/><path class="plot" id="plot-${c.key}"/></svg><div class="chart-meta"><span id="stats-${c.key}">Esperando muestras</span><span id="time-${c.key}">—</span></div>`;
  $('sensors').append(article);
});

function chart(c, points) {
  const values = points.map(p => p[1]).filter(v => typeof v === 'number' && Number.isFinite(v));
  if (!values.length) {
    $('plot-'+c.key).setAttribute('d','');
    $('stats-'+c.key).textContent = 'Sin muestras válidas';
    return;
  }
  let min = c.digital ? 0 : Math.min(...values), max = c.digital ? 1 : Math.max(...values);
  const constant = max === min;
  const span = max - min || 1;
  let path = '', previous = false;
  const start = points[0][0], duration = Math.max(points.at(-1)[0]-start, 1);
  points.forEach(([at,v]) => {
    if (v === null || !Number.isFinite(v)) { previous=false; return; }
    const plotted = c.digital ? Number(digitalActive(c,v)) : v;
    const x = 300*(at-start)/duration, y = constant ? 50 : 85-70*(plotted-min)/span;
    path += `${previous ? (c.digital ? 'H'+x+' V' : 'L'+x+' ') : 'M'+x+' '}${y} `;
    previous=true;
  });
  $('plot-'+c.key).setAttribute('d',path);
  $('stats-'+c.key).textContent = c.digital ? `1 = ${c.key==='light_gpio_high'?'con luz':c.key==='sound_detected'?'con sonido':'alarma'} · ${values.length} muestras` : `Mín ${min.toFixed(1)} / Máx ${max.toFixed(1)}`;
}

function render(data) {
  mq2ActiveLow = data.mq2_active_low !== false;
  $('connection').textContent=data.online?'ESP32 conectado':data.usb?'USB abierto · esperando datos':'ESP32 desconectado';
  $('connection').className=data.online?'online':'';
  $('port').textContent=data.port || 'Buscando adaptador CP2102';
  $('received').textContent=data.last_seen?`Última telemetría ${clock(data.last_seen)}`:'Sin telemetría recibida';
  $('warning').textContent=data.online?`En vivo por ${data.source==='mqtt'?'MQTT':'USB'}. Los estados reflejan señales recibidas; no verifican la conexión eléctrica de cada sensor.`:data.error || 'No hay telemetría reciente. Revisa el cable y cierra otros monitores seriales.';
  $('warning').className='notice'+(data.online?' good':'');
  channels.forEach(c=>{
    const sample=data.data[c.key], valid=sample && sample.value!==null;
    const fresh=data.online && sample && data.now-sample.at<6;
    $('value-'+c.key).textContent=valid?(c.digital?digitalLabel(c,sample.value):c.key==='mq2_ao_raw'?Math.round(sample.value):sample.value.toFixed(1)):'—';
    $('status-'+c.key).textContent=!fresh?'Sin señal reciente':valid?'Datos recibidos':'Lectura inválida';
    $('status-'+c.key).className='badge'+(fresh&&valid?' live':'');
    $('time-'+c.key).textContent=sample?clock(sample.at):'—';
    chart(c,data.histories[c.key]||[]);
  });
  servoLimits={min:data.servo.min_angle??45,max:data.servo.max_angle??135};
  $('angle').min=servoLimits.min;$('angle').max=servoLimits.max;
  if(Number($('angle').value)<servoLimits.min||Number($('angle').value)>servoLimits.max)$('angle').value=90;
  $('angle-value').textContent=$('angle').value+'°';
  document.querySelector('.range-labels span:first-child').textContent=servoLimits.min+'°';
  document.querySelector('.range-labels span:last-child').textContent=servoLimits.max+'°';
  disableServo(!data.control_enabled||!data.online||data.pending||sending);
  const request = data.servo.command_id ? ` · Orden #${data.servo.command_id}: ${data.servo.requested_angle}° solicitados` : '';
  const confirmed = data.servo.angle!==null ? ` · Último PWM confirmado: ${data.servo.angle}° nominales${data.servo.pulse_us?' / '+data.servo.pulse_us+' µs':''}` : ' · Sin PWM confirmado';
  $('servo-status').textContent=servoError || data.servo.status+request+confirmed+' · Eje físico no medido';
  if(data.servo.angle!==null) $('servo-arm').style.transform=`rotate(${data.servo.angle-180}deg)`;
  const log=$('logs'), nearBottom=log.scrollHeight-log.scrollTop-log.clientHeight<50;
  log.textContent=data.logs.map(l=>`${clock(l.at)}  ${l.text}`).join('\n')||(data.source==='mqtt'?'Sin registros MQTT recientes. El dominio no recibe el monitor USB.':'Esperando mensajes…');
  if(nearBottom) log.scrollTop=log.scrollHeight;
}

async function refresh() {
  try {
    const response=await fetch('/api/lab/',{cache:'no-store',signal:AbortSignal.timeout(12000)});
    if(!response.ok) throw new Error('Servidor no disponible');
    render(await response.json());
  } catch(error) {
    $('warning').textContent=error.name==='TimeoutError'?'El servidor tardó demasiado. Reintentando automáticamente; no se enviaron órdenes de movimiento.':'No se pudo actualizar: '+error.message;
    $('connection').textContent='Conexión al servidor interrumpida';
    $('connection').className='';
    disableServo(true);
    channels.forEach(c=>{ $('status-'+c.key).textContent='Datos sin actualizar'; $('status-'+c.key).className='badge'; });
  } finally {
    window.setTimeout(refresh,Number($('refresh').value));
  }
}
async function moveServo(angle) {
  if(!Number.isInteger(angle)||angle<0||angle>180)return;
  if(angle<servoLimits.min||angle>servoLimits.max){servoError='Actualiza el firmware por USB para ampliar el recorrido.';$('servo-status').textContent=servoError;return;}
  if((angle<10||angle>170)&&!window.confirm(`Orden real hacia ${angle}° nominales. Deja libre el brazo, evita topes y corta alimentación si zumba o se atasca. ¿Continuar?`))return;
  sending=true;
  servoError='';
  disableServo(true);
  try {
    const headers={'Content-Type':'application/json'};
    const response=await fetch('/api/lab/servo/',{method:'POST',headers,body:JSON.stringify({angle}),signal:AbortSignal.timeout(8000)});
    const result=await response.json();
    if(!response.ok) throw new Error(result.error||'No se pudo enviar la orden');
    $('servo-status').textContent='Orden enviada. Esperando confirmación PWM…';
  } catch(error) { servoError=error.message; $('servo-status').textContent=servoError; }
  finally { sending=false; }
}
$('angle').addEventListener('input',()=>{$('angle-value').textContent=$('angle').value+'°';});
$('send-servo').addEventListener('click',()=>moveServo(Number($('angle').value)));
document.querySelectorAll('[data-servo-angle]').forEach(button=>button.addEventListener('click',()=>{const angle=Number(button.dataset.servoAngle);$('angle').value=angle;$('angle-value').textContent=angle+'°';moveServo(angle);}));
$('toggle-log').addEventListener('click',()=>{ $('logs').hidden=!$('logs').hidden; $('toggle-log').textContent=$('logs').hidden?'Mostrar registro':'Ocultar registro'; $('toggle-log').setAttribute('aria-expanded',String(!$('logs').hidden)); });
refresh();
