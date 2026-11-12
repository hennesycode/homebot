const channels = [
  {key:'distance_cm', name:'Ultrasónico', pin:'HC-SR04 · TRIG 18 / ECHO 19', unit:'cm', note:'Distancia calculada · cada 500 ms'},
  {key:'temperature_c', name:'Temperatura', pin:'DHT11 · GPIO32', unit:'°C', note:'Muestra DHT11 · cada 2 segundos'},
  {key:'humidity_pct', name:'Humedad', pin:'DHT11 · GPIO32', unit:'% RH', note:'Humedad relativa · cada 2 segundos'},
  {key:'mq2_ao_raw', name:'Gas · salida analógica', pin:'MQ-2 AO · GPIO34 / ADC1', unit:'/ 4095', note:'ADC bruto · no calibrado, no PPM'},
  {key:'mq2_do_high', name:'Gas · salida digital', pin:'MQ-2 DO · GPIO27', unit:'', digital:true, note:'Polaridad y umbral sin calibrar'},
  {key:'sound_gpio_high', name:'Sonido', pin:'OUT · GPIO25', unit:'', digital:true, note:'Nivel digital, no decibelios'},
  {key:'light_gpio_high', name:'Luz', pin:'DO · GPIO26', unit:'', digital:true, note:'Nivel digital, no lux'}
];
const $ = (id) => document.getElementById(id);
const clock = (at) => new Date(at * 1000).toLocaleTimeString('es', {hour12:false});
let sending = false;
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
    const x = 300*(at-start)/duration, y = constant ? 50 : 85-70*(v-min)/span;
    path += `${previous ? (c.digital ? 'H'+x+' V' : 'L'+x+' ') : 'M'+x+' '}${y} `;
    previous=true;
  });
  $('plot-'+c.key).setAttribute('d',path);
  $('stats-'+c.key).textContent = c.digital ? `LOW 0 / HIGH 1 · ${values.length} muestras` : `Mín ${min.toFixed(1)} / Máx ${max.toFixed(1)}`;
}

function render(data) {
  $('connection').textContent=data.online?'ESP32 conectado':data.usb?'USB abierto · esperando datos':'ESP32 desconectado';
  $('connection').className=data.online?'online':'';
  $('port').textContent=data.port || 'Buscando adaptador CP2102';
  $('received').textContent=data.last_seen?`Última telemetría ${clock(data.last_seen)}`:'Sin telemetría recibida';
  $('warning').textContent=data.online?`En vivo por ${data.source==='mqtt'?'MQTT':'USB'}. Los estados reflejan señales recibidas; no verifican la conexión eléctrica de cada sensor.`:data.error || 'No hay telemetría reciente. Revisa el cable y cierra otros monitores seriales.';
  $('warning').className='notice'+(data.online?' good':'');
  channels.forEach(c=>{
    const sample=data.data[c.key], valid=sample && sample.value!==null;
    const fresh=data.online && sample && data.now-sample.at<6;
    $('value-'+c.key).textContent=valid?(c.digital?(sample.value?'HIGH':'LOW'):c.key==='mq2_ao_raw'?Math.round(sample.value):sample.value.toFixed(1)):'—';
    $('status-'+c.key).textContent=!fresh?'Sin señal reciente':valid?'Datos recibidos':'Lectura inválida';
    $('status-'+c.key).className='badge'+(fresh&&valid?' live':'');
    $('time-'+c.key).textContent=sample?clock(sample.at):'—';
    chart(c,data.histories[c.key]||[]);
  });
  $('send-servo').disabled=$('center-servo').disabled=!data.control_enabled||!data.online||data.pending||sending;
  $('servo-status').textContent=data.servo.status+(data.servo.angle!==null?` · ${data.servo.angle}° confirmados por firmware`:'');
  if(data.servo.angle!==null) $('servo-arm').style.transform=`rotate(${data.servo.angle-180}deg)`;
  const log=$('logs'), nearBottom=log.scrollHeight-log.scrollTop-log.clientHeight<50;
  log.textContent=data.logs.map(l=>`${clock(l.at)}  ${l.text}`).join('\n')||'Esperando mensajes…';
  if(nearBottom) log.scrollTop=log.scrollHeight;
}

async function refresh() {
  try {
    const response=await fetch('/api/lab/',{cache:'no-store',signal:AbortSignal.timeout(4000)});
    if(!response.ok) throw new Error('Servidor no disponible');
    render(await response.json());
  } catch(error) {
    $('warning').textContent='No se pudo actualizar: '+error.message;
    $('connection').textContent='Conexión al servidor interrumpida';
    $('connection').className='';
    $('send-servo').disabled=$('center-servo').disabled=true;
    channels.forEach(c=>{ $('status-'+c.key).textContent='Datos sin actualizar'; $('status-'+c.key).className='badge'; });
  } finally {
    window.setTimeout(refresh,Number($('refresh').value));
  }
}
async function moveServo(angle) {
  sending=true;
  $('send-servo').disabled=$('center-servo').disabled=true;
  try {
    const response=await fetch('/api/lab/servo/',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({angle}),signal:AbortSignal.timeout(4000)});
    const result=await response.json();
    if(!response.ok) throw new Error(result.error||'No se pudo enviar la orden');
    $('servo-status').textContent='Orden enviada. Esperando confirmación PWM…';
  } catch(error) { $('servo-status').textContent=error.message; }
  finally { sending=false; }
}
$('angle').addEventListener('input',()=>{$('angle-value').textContent=$('angle').value+'°';});
$('send-servo').addEventListener('click',()=>moveServo(Number($('angle').value)));
$('center-servo').addEventListener('click',()=>{ $('angle').value=90; $('angle-value').textContent='90°'; moveServo(90); });
$('toggle-log').addEventListener('click',()=>{ $('logs').hidden=!$('logs').hidden; $('toggle-log').textContent=$('logs').hidden?'Mostrar registro':'Ocultar registro'; $('toggle-log').setAttribute('aria-expanded',String(!$('logs').hidden)); });
refresh();
