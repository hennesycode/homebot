(() => {
  'use strict';
  const M = window.PhysicsMath;
  const $ = id => document.getElementById(id);
  const fmt = (n, digits=1) => M.finite(n) ? n.toLocaleString('es', {maximumFractionDigits:digits,minimumFractionDigits:digits}) : '—';
  const clock = at => new Date(at*1000).toLocaleTimeString('es', {hour12:false});
  const escape = text => String(text).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const configs = [
    {id:'ultrasonic',name:'HC-SR04',pin:'TRIG 18 / ECHO 19',key:'distance_cm',unit:'cm',x:110,y:90,w:140,h:80,d:20,color:'#2a6477',
      title:'Onda, eco y señal eléctrica',description:'El transductor piezoeléctrico transforma una excitación eléctrica en vibración. El eco vuelve a convertirse en una señal ECHO.',
      equation:'d = v t / 2',explanation:'La onda viaja hasta el objeto y vuelve: por eso dividimos entre dos.',
      limit:'La onda es mecánica, no electromagnética. ECHO se infiere de la distancia redondeada del firmware; no es una captura independiente.',source:'https://docs.sunfounder.com/projects/umsk/en/latest/02_arduino/uno_lesson08_ultrasonic.html'},
    {id:'mq2',name:'MQ-2',pin:'DO 27 / AO 34',key:'mq2_ao_raw',unit:'ADC / 4095',x:680,y:75,w:100,h:95,d:24,color:'#326685',
      title:'Conductividad del semiconductor',description:'La interacción con gases puede cambiar la resistencia del SnO₂ calentado. El módulo traduce esa variación en AO y un umbral DO.',
      equation:'Rs = RL (Vc / VRL − 1)',explanation:'Modelo del circuito resistivo básico. RL y el diseño del módulo deben conocerse para estimar Rs.',
      limit:'No se conocen RL, R₀ ni la curva de calibración. AO de alta impedancia no permite afirmar voltaje fiable, PPM ni ausencia de gas.',source:'https://www.winsen-sensor.com/sensors/flammable-gas-sensor/mq-2.html'},
    {id:'dht',name:'DHT11',pin:'DATA 32',key:'temperature_c',unit:'°C',x:700,y:335,w:90,h:110,d:25,color:'#2b708d',
      title:'Resistencia y ambiente',description:'El elemento de humedad resistivo y la medición térmica se convierten en una trama digital. La temperatura también modifica la velocidad del sonido.',
      equation:'HR = 100 e / es(T) %',explanation:'Definición de humedad relativa. El DHT11 entrega HR directamente; no mide las dos presiones por separado.',
      limit:'No se deducen presiones de vapor ni conductividad del aire a partir de estas lecturas. Respeta la resolución y exactitud del DHT11.',source:'https://learn.adafruit.com/dht/overview'},
    {id:'sound',name:'Sonido',pin:'OUT 25',key:'sound_detected',unit:'',x:80,y:295,w:100,h:80,d:17,color:'#3d6259',
      title:'Transducción y umbral eléctrico',description:'El micrófono transforma vibraciones en señal eléctrica. El comparador entrega un estado digital cuando cruza el umbral ajustado.',
      equation:'f_eventos = N / Δt',explanation:'Cuenta activaciones observadas, no la frecuencia de la onda acústica.',
      limit:'OUT no permite reconstruir el audio ni medir dB. El estado se retiene 1 s; ráfagas cercanas pueden agruparse y los huecos de datos se excluyen.',source:'https://learn.adafruit.com/adafruit-microphone-amplifier-breakout/overview'},
    {id:'light',name:'Luz',pin:'DO 26',key:'light_gpio_high',unit:'',x:235,y:455,w:95,h:80,d:18,color:'#6c5947',
      title:'Fotoconductividad',description:'La luz puede generar portadores en la fotoresistencia y reducir su resistencia. El comparador traduce esa respuesta a DO.',
      equation:'R_LDR ≈ K E^(−γ)',explanation:'Modelo empírico: K y γ dependen del componente. DO solo indica qué lado del umbral observamos.',
      limit:'LOW se interpreta como con luz según la prueba del montaje. No hay lecturas de resistencia ni lux; el modelo exacto del módulo sigue pendiente.',source:'https://learn.adafruit.com/photocells/overview'},
    {id:'servo',name:'SG90',pin:'PWM 23',key:'servo_angle',unit:'° ordenados',x:505,y:455,w:115,h:85,d:30,color:'#285c9a',
      title:'Electromagnetismo y movimiento',description:'El motor interno convierte energía eléctrica en par; los engranajes transmiten el movimiento. PWM solicita una posición al controlador del servo.',
      equation:'F = B I L sen(θ)',explanation:'Fuerza sobre un conductor recto en campo uniforme. Explica un principio del motor, no calcula el ángulo del servo.',
      limit:'No se miden campo B, corriente, par ni posición física del eje. La animación sigue una orden confirmada o un modelo explícito.',source:'https://www.towerpro.com.tw/product/sg90-7/'}
  ];
  const experiments = {
    reflection:{title:'A · Reflexión y distancia',hypothesis:'La distancia calculada a partir del tiempo de retorno se aproxima a una referencia conocida.',instructions:['Coloca una superficie plana a 10, 20 o 40 cm, medidos con regla.','Introduce la referencia real y registra al menos 20 muestras válidas.','Compara promedio, dispersión y error porcentual. Repite una sesión por distancia.'],key:'distance_cm',unit:'cm'},
    light:{title:'B · Fotoconductividad',hypothesis:'Cambiar la iluminación puede hacer que el comparador eléctrico cruce su umbral.',instructions:['Cubre y descubre el sensor sin alterar el cableado.','Observa DO y anota cuándo cambia la iluminación.','Evalúa las transiciones, no una iluminancia en lux ni el valor de la LDR.'],key:'light_gpio_high',unit:'DO'},
    environment:{title:'C · Ambiente y propagación',hypothesis:'La corrección de velocidad del sonido depende de la temperatura; no prueba por sí misma mayor exactitud.',instructions:['Mantén fija la superficie reflectante y registra temperatura, humedad y distancia.','Compara el cálculo fijo de 343 m/s con v(T).','No calientes directamente los sensores ni interpretes correlaciones como causas.'],key:'distance_cm',unit:'cm'},
    motor:{title:'D · Electromagnetismo y PWM',hypothesis:'Distintas órdenes PWM solicitan distintas posiciones al servo.',instructions:['Deja libre el brazo y utiliza alimentación de 5 V adecuada y GND común.','Solo pulsa Enviar orden al SG90 real si deseas movimiento físico.','Registra órdenes confirmadas. Sin realimentación no puedes afirmar el ángulo alcanzado.'],key:'servo_angle',unit:'° ordenados'}
  };
  let selected='ultrasonic', mode='live', activeTab='map', live=null, liveError='';
  let simHistory={}, recording=null, replay=null, replayIndex=0, replayTimer=null, recordTimer=null;
  let lastSession=null, unsaved=false;
  let camera={x:48,z:-22,zoom:1}, dragging=null, dragged=false, servoPreview=90, previewChanged=false, servoSending=false;
  let dbPromise=null, currentSnapshot=null, historyBusy=false;
  const simValues={distance_cm:25,temperature_c:25,humidity_pct:60,mq2_ao_raw:500,sound_detected:0,light_gpio_high:0,mq2_do_high:1};
  const legacyServoProfile={min_angle:45,max_angle:135,min_pulse_us:1100,max_pulse_us:1900};
  const nominalServoProfile={min_angle:0,max_angle:180,min_pulse_us:1000,max_pulse_us:2000};
  function servoProfile(s) {return M.finite(s?.servo?.min_angle)?s.servo:mode==='sim'?nominalServoProfile:legacyServoProfile;}

  function value(snapshot,key) {
    if (key==='servo_angle') return M.finite(snapshot?.data?.servo_angle?.value) ? snapshot.data.servo_angle.value : M.finite(snapshot?.servo?.angle) ? snapshot.servo.angle : null;
    const sample=snapshot?.data?.[key];
    return M.finite(sample?.value) ? sample.value : null;
  }
  function fresh(snapshot,key) {
    if (mode!=='live') return value(snapshot,key)!==null;
    if (!snapshot?.online) return false;
    if (key==='servo_angle') return value(snapshot,key)!==null;
    const sample=snapshot.data[key];
    return sample && snapshot.now-sample.at<=6 && value(snapshot,key)!==null;
  }
  function currentValue(s,key) { return fresh(s,key) ? value(s,key) : null; }
  function digitalLabel(key,v,snapshot) {
    if (v===null) return 'Sin lectura';
    if (key==='sound_detected') return v ? 'Con sonido':'Sin sonido';
    if (key==='light_gpio_high') return v ? 'Sin luz':'Con luz';
    const active=snapshot?.mq2_active_low===false ? Boolean(v):!v;
    return active ? 'Alarma del umbral':'Sin alarma del umbral';
  }
  function snapshot() {
    if (mode==='live') return live || {online:false,now:Date.now()/1000,data:{},histories:{},servo:{angle:null}};
    if (mode==='replay' && replay) {
      const sample=replay.samples[replayIndex];
      const data=Object.fromEntries(Object.entries(sample.values).map(([k,v])=>[k,{value:v,at:sample.received_at?.[k]??sample.at}]));
      const histories={};
      for (const key of Object.keys(sample.values)) histories[key]=replay.samples.slice(Math.max(0,replayIndex-119),replayIndex+1).map(s=>[s.at,s.values[key]]);
      return {online:false,now:sample.at,last_seen:sample.at,data,histories,mq2_active_low:replay.mq2ActiveLow,servo:{...(replay.servoProfile||legacyServoProfile),angle:sample.values.servo_angle}};
    }
    const now=Date.now()/1000;
    return {online:false,now,last_seen:now,source:'simulation',data:Object.fromEntries(Object.entries(simValues).map(([k,v])=>[k,{value:v,at:now}])),histories:simHistory,mq2_active_low:true,servo:{angle:servoPreview}};
  }
  function simulationSample() {
    const now=Date.now()/1000;
    for (const [key,v] of Object.entries({...simValues,servo_angle:servoPreview})) {
      (simHistory[key] ||= []).push([now,v]);
      if(simHistory[key].length>120) simHistory[key].shift();
    }
    if(mode==='sim') { render(); capture(currentSnapshot); }
  }
  function setMode(next) {
    if(recording) { $('record-status').textContent='Finaliza la sesión antes de cambiar de origen.'; tab('experiments'); return; }
    stopReplay(); mode=next;
    $('mode-live').setAttribute('aria-pressed',String(next==='live'));
    $('mode-sim').setAttribute('aria-pressed',String(next==='sim'));
    $('simulation-dock').hidden=next!=='sim';
    $('replay-controls').hidden=next!=='replay';
    if(next==='sim') simulationSample();
    render();
  }
  function tab(name) {
    activeTab=name;
    document.querySelectorAll('[data-panel]').forEach(el=>{el.hidden=el.dataset.panel!==name;});
    document.querySelectorAll('[data-tab]').forEach(el=>{if(el.dataset.tab===name)el.setAttribute('aria-current','page');else el.removeAttribute('aria-current');});
    if(name==='history') loadHistory();
    render(); updateCamera();
  }
  function choose(id) {
    selected=id;
    document.querySelectorAll('[data-component]').forEach(el=>{el.setAttribute('aria-pressed',String(el.dataset.component===id));});
    render();
  }
  function buildModels() {
    const modelRoot=$('component-models');
    const box=(w,h,d,color)=>`<div class="box" style="--w:${w}px;--h:${h}px;--d:${d}px;--material:${color}">${['front','back','left','right','top','bottom'].map(f=>`<i class="face ${f}"></i>`).join('')}</div>`;
    const board=document.createElement('div'); board.className='model esp'; board.style.cssText='left:380px;top:210px;width:140px;height:170px';
    board.innerHTML=box(140,170,16,'#284b46')+'<span class="model-symbol">ESP<br>32</span><span class="model-label">Señal → información</span>';
    modelRoot.append(board);
    $('trace-paths').insertAdjacentHTML('beforeend','<g class="power-topology"><path class="power-wire" d="M60 26H830"/><path class="logic-power-wire" d="M60 50H830"/><path class="ground-wire" d="M60 574H830"/><text x="65" y="18">5 V nominales · HC / MQ-2</text><text x="590" y="43">3,3 V nominales · lógica</text><text x="650" y="593">GND común · sin corriente medida</text></g>');
    configs.forEach(c=>{
      const node=document.createElement('button'); node.type='button'; node.className='model '+c.id; node.dataset.component=c.id;
      node.style.cssText=`left:${c.x}px;top:${c.y}px;width:${c.w}px;height:${c.h}px`;
      node.setAttribute('aria-label',`Explorar ${c.name}, GPIO ${c.pin}`);
      node.innerHTML=box(c.w,c.h,c.d,c.color)+`<span class="model-label">${c.name}</span><span class="model-symbol">${c.id==='servo'?'SG90':''}</span><span class="model-readout" id="model-value-${c.id}">—</span>`+(c.id==='ultrasonic'?'<i class="wave-ring"></i>':'')+(c.id==='servo'?'<i class="servo-arm" id="model-servo-arm"></i><span class="motor-field">N → I → S</span>':'')+(c.id==='sound'?'<i class="sound-ring"></i>':'')+(c.id==='light'?'<i class="light-beam"></i>':'')+(c.id==='dht'?`<span class="vapor">${Array.from({length:8},(_,i)=>`<i style="left:${i%4*25}px;top:${Math.floor(i/4)*25-25}px"></i>`).join('')}</span>`:'');
      node.addEventListener('click',event=>{if(event.detail===0||!dragged)choose(c.id);});
      modelRoot.append(node);
      const button=document.createElement('button');button.type='button';button.dataset.component=c.id;button.textContent=c.name;button.addEventListener('click',()=>choose(c.id));$('component-picker').append(button);
      const targetX=c.x+c.w/2,targetY=c.y+c.h/2;
      const path=`M450 295 L${targetX} 295 L${targetX} ${targetY}`;
      $('trace-paths').insertAdjacentHTML('beforeend',`<path class="wire" d="${path}"/><path class="wire-flow" d="${path}"/>`);
      const rail=['ultrasonic','mq2'].includes(c.id)?26:50;
      const supply=c.id==='servo'?`<path class="power-wire" d="M${targetX} ${targetY}H830V520"/><text x="670" y="514">SG90: 5 V regulados externos</text>`:`<path class="${rail===26?'power-wire':'logic-power-wire'}" d="M${targetX+12} ${targetY}V${rail}"/>`;
      $('trace-paths').insertAdjacentHTML('beforeend',`<g class="power-topology">${supply}<path class="ground-wire" d="M${targetX-12} ${targetY}V574"/></g>`);
      const card=document.createElement('article');card.className='phenomenon-card';
      card.innerHTML=`<span class="pill">${c.name} · GPIO ${c.pin}</span><h3 style="margin-top:15px">${c.title}</h3><p>${c.description}</p><div class="equation">${c.equation}</div><p>${c.explanation}</p><div id="phen-value-${c.id}" class="live-value">—</div><p class="limit">${c.limit}</p><p><a href="${c.source}" target="_blank" rel="noopener noreferrer">Referencia técnica</a></p><button type="button">Ver en el montaje 3D</button>`;
      card.querySelector('button').addEventListener('click',()=>{choose(c.id);tab('map');});$('phenomena-grid').append(card);
    });
    for(const [x,y,label]of [[180,218,'ECHO / GPIO19'],[720,212,'DO / GPIO27'],[767,245,'AO / GPIO34']]){
      $('trace-paths').insertAdjacentHTML('beforeend',`<g class="divider-marker"><rect x="${x-12}" y="${y-11}" width="24" height="22" rx="3"/><path d="M${x-5} ${y-10}V${y+10}M${x+3} ${y-10}V${y+10}"/><text x="${x-35}" y="${y+27}">${label}</text></g>`);
    }
  }
  function updateCamera() {
    const width=$('stage').clientWidth || 850;
    const scale=Math.min(width/980,0.94)*camera.zoom;
    $('rig').style.transform=`translate(-50%,-50%) rotateX(${camera.x}deg) rotateZ(${camera.z}deg) scale(${scale})`;
  }
  function readingsLabel(c,s) {
    const v=value(s,c.key);
    if(v===null)return '—';
    if(['sound_detected','light_gpio_high'].includes(c.key))return digitalLabel(c.key,v,s);
    return fmt(v,c.id==='mq2'?0:1);
  }
  function equations(c,s) {
    const d=currentValue(s,'distance_cm'),t=currentValue(s,'temperature_c'),u=M.ultrasound(d,t);
    if(c.id==='ultrasonic')return `<div class="equation">d = v t / 2</div><p class="substitution">${u?`ECHO inferido ≈ ${fmt(u.echoUs,0)} µs a partir de ${fmt(d)} cm.`:'Esperando una distancia válida.'}</p><div class="equation">v(T) ≈ 331,3 + 0,606 T</div><p class="substitution">${u&&u.speed!==null?`v(${fmt(t)} °C) ≈ ${fmt(u.speed)} m/s; d corregida ≈ ${fmt(u.corrected,2)} cm (modelo).`:'Sin temperatura válida no se calcula compensación.'}</p>`;
    if(c.id==='dht')return `<div class="equation">HR = 100 e / es(T) %</div><p class="substitution">T = ${fmt(t)} °C · HR = ${fmt(value(s,'humidity_pct'))} %</p><p class="muted">La humedad representa una proporción; e y es no están medidos por separado.</p>`;
    if(c.id==='mq2')return `<div class="equation">Rs = RL (Vc / VRL − 1)</div><p class="substitution">AO = ${fmt(value(s,'mq2_ao_raw'),0)} / 4095 · DO: ${value(s,'mq2_do_high')===null?'—':value(s,'mq2_do_high')?'HIGH':'LOW'}</p><p class="muted">${digitalLabel('mq2_do_high',value(s,'mq2_do_high'),s)}. Calibración pendiente.</p>`;
    if(c.id==='sound') {
      const history=(s.histories?.sound_detected || []).map(([at,v])=>({at,values:{sound_detected:v}}));
      const stats=M.transitions(history,'sound_detected');
      return `<div class="equation">f_eventos = N / Δt</div><p class="substitution">${stats.rising} activaciones observadas; ${fmt(stats.eventsPerMinute)} eventos/min.</p><p class="muted">Estado activo: ${fmt(stats.dutyPercent)} % del tiempo cubierto, excluyendo huecos mayores de 6 s.</p>`;
    }
    if(c.id==='light')return `<div class="equation">R_LDR ≈ K E^(−γ)</div><p class="substitution">${digitalLabel('light_gpio_high',value(s,'light_gpio_high'),s)} · DO ${value(s,'light_gpio_high')===null?'—':value(s,'light_gpio_high')?'HIGH':'LOW'}</p><p class="muted">E, K, γ y R no están medidos: esta ecuación no se resuelve con DO.</p>`;
    const angle=value(s,'servo_angle');
    const profile=servoProfile(s);
    return `<div class="equation">F = B I L sen(θ)</div><div class="equation">p(θ) = ${profile.min_pulse_us} + (θ − ${profile.min_angle}) · ${profile.max_pulse_us-profile.min_pulse_us}/${profile.max_angle-profile.min_angle}</div><p class="substitution">Última orden: ${fmt(angle,0)}° nominales · pulso calculado ${fmt(M.servoPulse(angle,profile),0)} µs. Periodo 20 ms. Recorrido físico sin calibrar.</p>`;
  }
  function drawChart(svg,points,width=360,height=110,digital=false) {
    const valid=points.filter(([at,v])=>M.finite(at)&&M.finite(v));
    const stats=M.statistics(valid.map(p=>p[1]));
    svg.replaceChildren();
    const ns='http://www.w3.org/2000/svg';
    function shape(tag,attrs){const el=document.createElementNS(ns,tag);for(const [key,v]of Object.entries(attrs))el.setAttribute(key,v);svg.append(el);return el;}
    for(const ratio of [.2,.5,.8])shape('path',{d:`M0 ${height*ratio} H${width}`,class:'chart-grid'});
    if(!stats){const text=shape('text',{x:10,y:height/2});text.textContent='Sin muestras válidas';return null;}
    const lo=digital?0:stats.min,hi=digital?1:stats.max;
    const first=valid[0][0],span=Math.max(valid.at(-1)[0]-first,0.001);
    let path='',previous=false,last=null,lastAt=null;
    for(const [at,v]of points){
      if(!M.finite(at)||!M.finite(v)){previous=false;continue;}
      if(lastAt!==null&&at-lastAt>6)previous=false;
      const x=12+(width-24)*(at-first)/span,y=hi===lo?height/2:height-18-(height-36)*(v-lo)/(hi-lo);
      path+=`${previous?(digital?' H'+x+' V':' L'+x+' '):' M'+x+' '}${y}`;previous=true;last={x,y};lastAt=at;
    }
    shape('path',{d:path,class:'chart-line'});
    if(last)shape('circle',{cx:last.x,cy:last.y,r:3,class:'chart-dot'});
    return stats;
  }
  function render() {
    const s=snapshot(); currentSnapshot=s;
    const provenance=$('provenance');provenance.className='provenance'+(mode==='sim'?' sim':mode==='replay'?' replay':'');
    provenance.textContent=mode==='sim'?'Simulación educativa. Todos los valores de esta vista proceden de controles, no del ESP32.':mode==='replay'?`Reproducción de «${replay.title}» (${replay.mode==='live'?'datos registrados':'simulación registrada'}). No controla el hardware.`:liveError||'Datos recibidos del ESP32. Ecuaciones derivadas y geometría conceptual se identifican por separado.';
    $('physics-connection').textContent=mode==='sim'?'Simulación · sin mediciones':mode==='replay'?'Reproducción · hardware sin cambios':s.online?`ESP32 en vivo · ${s.source==='mqtt'?'MQTT':'USB'}`:'ESP32 sin telemetría reciente';
    $('physics-connection').className='connection'+(mode==='live'&&s.online?' live':'');
    const c=configs.find(c=>c.id===selected),available=fresh(s,c.key);
    $('selected-gpio').textContent='GPIO '+c.pin;
    $('selected-title').textContent=c.title;
    $('selected-description').textContent=c.description;
    $('selected-value').textContent=readingsLabel(c,s);$('selected-unit').textContent=c.unit;
    $('selected-freshness').textContent=mode==='live'?(available?(c.id==='servo'?'Orden confirmada':'Datos recientes'):'Sin lectura vigente'):!available?'Sin lectura':mode==='sim'?'Simulado':'Registrado';
    $('selected-time').textContent=c.id==='servo'?`Se representa la orden, no la posición.${s.data?.servo_angle?' ACK recibido: '+clock(s.data.servo_angle.at):''}`:s.data?.[c.key]?`Recepción: ${clock(s.data[c.key].at)}${available?'':' · lectura desactualizada'}`:'Esperando datos de este canal.';
    $('selected-equations').innerHTML=equations(c,s);$('selected-limit').textContent=c.limit;
    const points=s.histories?.[c.key] || [];
    drawChart($('selected-chart'),points,360,110,['sound_detected','light_gpio_high'].includes(c.key));
    configs.forEach(item=>{
      const node=document.querySelector('.model.'+item.id);node.classList.toggle('active',item.id===selected);node.classList.toggle('stale',!fresh(s,item.key));
      $('phen-value-'+item.id).textContent=readingsLabel(item,s)+(item.unit?' '+item.unit:'')+(mode==='live'&&!fresh(s,item.key)?' · sin vigencia':'');
      const reading=value(s,item.key),current=fresh(s,item.key);
      $('model-value-'+item.id).textContent=item.id==='dht'?`${fmt(reading)} °C / ${fmt(value(s,'humidity_pct'),0)} %`:readingsLabel(item,s)+(item.unit?' '+item.unit:'');
      if(item.id==='ultrasonic'){
        const size=reading===null?80:Math.min(260,60+reading*.65);
        const ring=node.querySelector('.wave-ring');ring.style.width=ring.style.height=size+'px';ring.style.left=ring.style.top=`calc(50% - ${size/2}px)`;ring.style.display=current?'':'none';
      }
      if(item.id==='sound')node.classList.toggle('triggered',current&&Boolean(reading));
      if(item.id==='light')node.classList.toggle('illuminated',current&&reading===0);
      if(item.id==='mq2'){
        const high=value(s,'mq2_do_high');node.classList.toggle('threshold',current&&high!==null&&(s.mq2_active_low===false?Boolean(high):!high));
      }
      if(item.id==='dht'){
        const humidity=currentValue(s,'humidity_pct');
        node.querySelectorAll('.vapor i').forEach((particle,index)=>{particle.style.visibility=humidity!==null&&index<Math.round(humidity/100*8)?'visible':'hidden';});
      }
    });
    const angle=mode==='replay'?value(s,'servo_angle'):previewChanged||mode==='sim'?servoPreview:value(s,'servo_angle');
    $('model-servo-arm').style.transform=`translateZ(42px) rotateZ(${(angle??90)-180}deg)`;
    $('rig').classList.toggle('flowing',mode!=='live'||s.online);
    $('physics-auth').hidden=live?.source==='usb';
    const profile=servoProfile(live);
    $('physics-servo-send').disabled=mode!=='live'||recording?.mode==='sim'||!live?.online||!live?.control_enabled||live.pending||servoSending||servoPreview<profile.min_angle||servoPreview>profile.max_angle;
    if(mode==='live')$('servo-model-note').textContent=`El deslizador solo mueve el modelo. Firmware actual: ${profile.min_angle}–${profile.max_angle}° nominales. Pulsa Enviar orden para mover el SG90; ${profile.max_angle<180?'conecta USB para cargar el rango ampliado.':'no fuerces topes; el recorrido físico requiere calibración.'}`;
    if(activeTab==='signals')renderSignals(s);
    if(mode==='replay')$('replay-at').textContent=`${replayIndex+1} / ${replay.samples.length} · ${clock(s.now)}`;
  }
  function renderSignals(s) {
    const key=$('signal-channel').value,points=s.histories?.[key]||[];
    const digital=['sound_detected','light_gpio_high','mq2_do_high'].includes(key);
    const stats=drawChart($('signal-chart'),points,1000,230,digital);
    $('signal-stats').textContent=stats?`${stats.count} muestras de recepción · mínimo ${fmt(stats.min)} · máximo ${fmt(stats.max)} · σ poblacional ${fmt(stats.sd,2)}. Sin captura de forma de onda real.`:'No hay historial válido para este canal.';
    const u=M.ultrasound(currentValue(s,'distance_cm'),currentValue(s,'temperature_c'));
    const t=u?.echoUs;
    const x=t?Math.min(510,80+t/25000*400):80;
    $('pulse-chart').innerHTML=`<path class="chart-grid" d="M70 50H540 M70 130H540"/><text x="0" y="48">TRIG</text><text x="0" y="128">ECHO</text><path class="chart-line" d="M70 60H80V25H84V60H540"/>${t?`<path class="chart-line" d="M70 140H90V105H${Math.max(100,x)}V140H540"/>`:''}`;
    $('pulse-note').textContent=t?`TRIG = 10 µs programados. ECHO ≈ ${fmt(t,0)} µs inferidos de d, no capturados. Diagrama esquemático, no a escala en TRIG ni con latencia medida.`:'Sin distancia válida: no se reconstruye ECHO. TRIG es una orden programada, no una medición de tensión.';
    const entries=[];
    for(const [channel,label]of [['sound_detected','Sonido'],['light_gpio_high','Luz'],['mq2_do_high','MQ-2 DO']]){
      let previous=null,previousAt=null;
      for(const [at,v]of s.histories?.[channel]||[]){if(!M.finite(v)){previous=null;continue;}if(previousAt!==null&&at-previousAt>6)previous=null;if(previous!==null&&previous!==v)entries.push({at,text:`${label}: ${digitalLabel(channel,v,s)}`});previous=v;previousAt=at;}
    }
    entries.sort((a,b)=>b.at-a.at);
    $('event-timeline').replaceChildren(...entries.slice(0,20).map(entry=>{const li=document.createElement('li');li.textContent=`${clock(entry.at)} · ${entry.text}`;return li;}));
    if(!entries.length){const li=document.createElement('li');li.textContent='No hay cambios observados en esta ventana.';$('event-timeline').append(li);}
  }
  function updateCircuit() {
    const vin=Number($('vin').value)/10,r1=Number($('r1').value),r2=Number($('r2').value),result=M.divider(vin,r1,r2);
    $('vin-value').textContent=fmt(vin)+' V';$('r1-label').textContent='R1 = '+fmt(r1)+' kΩ';$('r2-label').textContent='R2 = '+fmt(r2)+' kΩ';
    $('divider-gpio').textContent='GPIO'+$('divider-select').value;
    $('divider-node').textContent=result?fmt(result.voltage,3)+' V teóricos':'Valores inválidos';
    $('divider-results').innerHTML=result?resultItems([['Vout teórico',fmt(result.voltage,3)+' V'],['I teórica',fmt(result.current*1e6,2)+' µA'],['Rth salida',fmt(result.resistance,1)+' kΩ'],['R total',fmt(r1+r2,1)+' kΩ']]):'<p>Introduce resistencias positivas y una entrada no negativa.</p>';
    $('divider-warning').textContent=!result?'No es posible resolver el circuito.':result.voltage>3.3?'El resultado teórico supera 3,3 V. No apliques esta simulación al GPIO.':'El cálculo no certifica seguridad. Rth elevada carga mal el ADC; tolerancias y pulsos requieren verificación física independiente.';
    const rl=Number($('mq-rl').value),vrl=Number($('mq-vrl').value);
    $('mq-resistance').textContent=rl>0&&vrl>0&&vrl<=5?`Rs simulada = ${fmt(rl*(5/vrl-1),2)} kΩ`:'Se requiere RL > 0 y 0 < VRL ≤ 5 V.';
  }
  function updateForce() {
    const b=Number($('field').value)/100,i=Number($('current').value)/1000,a=Number($('field-angle').value),f=M.force(b,i,.02,a);
    $('field-value').textContent=fmt(b,2)+' T';$('current-value').textContent=fmt(i*1000,0)+' mA';$('field-angle-value').textContent=fmt(a,0)+'°';
    $('force-result').textContent=`F simulada = ${fmt(f*1000,3)} mN. Son parámetros de estudio, no mediciones del SG90.`;
    $('conductor').style.transform=`rotate(${a-90}deg)`;$('force-arrow').style.opacity=String(.2+Math.min(1,f/.02)*.8);
  }
  function resultItems(items) {return items.map(([label,text])=>`<div class="result-item"><strong>${escape(text)}</strong><span>${escape(label)}</span></div>`).join('');}
  function experimentInfo() {
    const info=experiments[$('experiment-kind').value];$('experiment-title').textContent=info.title;$('experiment-hypothesis').textContent='Hipótesis: '+info.hypothesis;
    $('experiment-instructions').replaceChildren(...info.instructions.map(text=>{const li=document.createElement('li');li.textContent=text;return li;}));
    $('reference-label').hidden=$('experiment-kind').value!=='reflection';
  }
  function sampleFrom(s) {
    const values={};const received={};
    for(const key of ['distance_cm','temperature_c','humidity_pct','mq2_ao_raw','mq2_do_high','sound_detected','light_gpio_high']){
      values[key]=fresh(s,key)?value(s,key):null;received[key]=s.data?.[key]?.at??null;
    }
    values.servo_angle=value(s,'servo_angle');
    received.servo_angle=s.data?.servo_angle?.at??null;
    return {at:s.now,source:mode==='live'?s.source:'simulation',values,received_at:received};
  }
  function capture(s) {
    if(!recording||mode==='replay'||(mode==='live'&&!s.online))return;
    const previous=recording.samples.at(-1);
    const frames=[];
    if(mode!=='live'||!previous)frames.push(sampleFrom(s));
    else {
      const keys=['distance_cm','temperature_c','humidity_pct','mq2_ao_raw','mq2_do_high','sound_detected','light_gpio_high','servo_angle'];
      const times=new Set();
      for(const key of keys)for(const [at]of s.histories?.[key]||[])if(at>previous.at&&at<=s.now)times.add(at);
      for(const at of [...times].sort((a,b)=>a-b)){
        const values={},received_at={};
        for(const key of keys){
          const point=(s.histories?.[key]||[]).findLast(p=>p[0]<=at);
          values[key]=point&&(key==='servo_angle'||at-point[0]<=6)?point[1]:null;
          received_at[key]=point?.[0]??null;
        }
        frames.push({at,source:s.source,values,received_at});
      }
    }
    for(const sample of frames)if(M.finite(sample.at)&&recording.samples.at(-1)?.at!==sample.at&&recording.samples.length<600)recording.samples.push(sample);
    if(!frames.length)return;
    renderResults(recording);
    $('record-status').textContent=`Grabando ${mode==='live'?'datos recibidos':'simulación'} · ${recording.samples.length} instantes registrados. ${mode==='live'?'Los resultados cuentan timestamps únicos del canal.':'Mueve los controles para registrar cambios.'}`;
    if(recording.samples.length>=600||Date.now()-recording.startedAt>600000)finishRecording();
  }
  function renderResults(session) {
    const info=experiments[session.kind],samples=session.samples,points=M.channelPoints(session,info.key),stats=M.statistics(points.map(p=>p.value),session.reference);
    if(!stats){$('experiment-results').textContent='Todavía no hay muestras válidas para este experimento.';drawChart($('experiment-chart'),[],560,200);return;}
    const list=[['Muestras válidas únicas del canal',String(stats.count)],['Promedio',fmt(stats.mean,2)+' '+info.unit],['Mínimo / máximo',`${fmt(stats.min,2)} / ${fmt(stats.max,2)}`],['Desviación σ',fmt(stats.sd,3)+' '+info.unit]];
    if(stats.errorPercent!==null)list.push(['Error del promedio',fmt(stats.errorPercent,2)+' %']);
    if(session.kind==='light'){
      const active=samples.map(s=>({at:s.at,values:{light:s.values.light_gpio_high===null?null:1-s.values.light_gpio_high}}));
      const result=M.transitions(active,'light');list.push(['Tiempo con luz (cubierto)',fmt(result.dutyPercent)+' %']);
    }
    if(session.kind==='environment'){
      const corrected=points.map(p=>M.ultrasound(p.value,p.frame.values.temperature_c)?.corrected??null);
      list.push(['Promedio compensado (modelo)',fmt(M.statistics(corrected)?.mean,2)+' cm']);
    }
    if(session.kind==='motor')list.push(['Pulso del promedio (modelo)',fmt(M.servoPulse(stats.mean,session.servoProfile||legacyServoProfile),0)+' µs']);
    $('experiment-results').innerHTML=resultItems(list);
    drawChart($('experiment-chart'),points.map(p=>[p.at,p.value]),560,200,session.kind==='light');
    $('experiment-conclusion').textContent=`${session.mode==='live'?'Evidencia de recepción, no de calibración.':'Simulación: no valida hardware.'} ${session.kind==='reflection'&&stats.count<20?'Aún faltan muestras: reúne al menos 20 por referencia.':session.kind==='reflection'?'Compara el error con la incertidumbre de la regla y la especificación del sensor.':'Las relaciones temporales no demuestran causalidad ni una posición física medida.'}`;
  }
  async function database() {
    if(!('indexedDB' in window))throw new Error('Este navegador no permite guardar sesiones.');
    if(!dbPromise)dbPromise=new Promise((resolve,reject)=>{const request=indexedDB.open('homebot-physics',1);request.onupgradeneeded=()=>request.result.createObjectStore('experiments',{keyPath:'id'});request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(new Error('No se pudo abrir el almacenamiento local.'));});
    return dbPromise;
  }
  async function storeSession(session) {
    const db=await database();
    return new Promise((resolve,reject)=>{const tx=db.transaction('experiments','readwrite');tx.objectStore('experiments').put(session);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(new Error('No se pudo guardar: revisa el espacio o los permisos del navegador.'));tx.onabort=()=>reject(new Error('La sesión no se guardó. Puedes exportarla.'));});
  }
  function startRecording() {
    if(recording)return;
    if(unsaved){$('record-status').textContent='Exporta la última sesión antes de iniciar otra: no se pudo guardar en este navegador.';return;}
    if(mode==='replay'){ $('record-status').textContent='Sal de reproducción antes de iniciar una sesión.';return; }
    if(mode==='live'&&!live?.online){$('record-status').textContent='No hay telemetría reciente. Conecta el ESP32 o elige Simulación.';return;}
    const reference=$('experiment-kind').value==='reflection'?Number($('reference-distance').value):null;
    if(reference!==null&&(!M.finite(reference)||reference<2||reference>400)){$('record-status').textContent='La referencia debe estar entre 2 y 400 cm.';return;}
    const profile=servoProfile(snapshot());
    recording={id:crypto.randomUUID(),title:$('experiment-name').value.trim()||'Experimento sin título',kind:$('experiment-kind').value,mode,reference,startedAt:Date.now(),endedAt:null,mq2ActiveLow:mode==='sim'||live?.mq2_active_low!==false,servoProfile:{min_angle:profile.min_angle,max_angle:profile.max_angle,min_pulse_us:profile.min_pulse_us,max_pulse_us:profile.max_pulse_us},samples:[],version:2};
    recordTimer=setTimeout(finishRecording,600000);
    $('record-start').disabled=true;$('record-stop').disabled=false;$('experiment-kind').disabled=true;$('reference-distance').disabled=true;
    capture(snapshot());
  }
  async function finishRecording() {
    if(!recording)return;
    const session=recording;recording=null;session.endedAt=Date.now();clearTimeout(recordTimer);recordTimer=null;
    $('record-start').disabled=false;$('record-stop').disabled=true;$('experiment-kind').disabled=false;$('reference-distance').disabled=false;
    if(!session.samples.length){$('record-status').textContent='Sin muestras: la sesión no se guarda.';return;}
    lastSession=session;$('export-last').disabled=false;$('record-start').disabled=true;
    try{await storeSession(session);unsaved=false;$('record-status').textContent=`Sesión guardada en este navegador: ${session.samples.length} instantes. Abre Historial para reproducir y exportar.`;}
    catch(error){unsaved=true;$('record-status').textContent=error.message+' Usa Exportar última sesión para conservar una copia JSON.';}
    finally{$('record-start').disabled=false;}
    renderResults(session);
  }
  async function loadHistory() {
    if(historyBusy)return;historyBusy=true;
    try{
      const db=await database();const sessions=await new Promise((resolve,reject)=>{const request=db.transaction('experiments').objectStore('experiments').getAll();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(new Error('No se pudo leer el historial local.'));});
      sessions.sort((a,b)=>b.startedAt-a.startedAt);$('history-list').replaceChildren();
      if(!sessions.length){$('history-list').textContent='Aún no hay sesiones. Inicia un experimento y finalízalo para guardarlo.';return;}
      for(const session of sessions){
        const article=document.createElement('article');article.className='history-item';
        const title=document.createElement('h3');title.textContent=session.title;
        const meta=document.createElement('p');meta.textContent=`${new Date(session.startedAt).toLocaleString('es')} · ${session.mode==='live'?'Datos recibidos':'Simulación'} · ${session.samples.length} muestras`;
        const text=document.createElement('div');text.append(title,meta);article.append(text);
        const actions=document.createElement('div');actions.className='button-row';
        for(const [label,action]of [['Reproducir',()=>beginReplay(session)],['JSON',()=>download(session.title+'.json',JSON.stringify(session,null,2),'application/json')],['CSV',()=>exportCSV(session)],['Informe',()=>exportReport(session)]]){
          const button=document.createElement('button');button.type='button';button.textContent=label;button.addEventListener('click',action);actions.append(button);
        }
        article.append(actions);$('history-list').append(article);
      }
    }catch(error){$('history-list').textContent=error.message;}finally{historyBusy=false;}
  }
  function beginReplay(session) {
    if(recording){$('record-status').textContent='Finaliza el registro antes de reproducir otra sesión.';tab('experiments');return;}
    if(!session.samples.length)return;
    replay=session;replayIndex=0;setMode('replay');
    $('replay-position').max=session.samples.length-1;$('replay-position').value=0;$('replay-title').textContent=session.title;
    renderResults(session);render();
  }
  function stopReplay() {if(replayTimer!==null){clearTimeout(replayTimer);replayTimer=null;}$('replay-play').textContent='Reproducir';}
  function playReplay() {
    if(replayTimer!==null){stopReplay();return;}
    if(!replay||mode!=='replay')return;
    if(replayIndex>=replay.samples.length-1)replayIndex=0;
    const step=()=>{if(mode!=='replay'){stopReplay();return;}render();$('replay-position').value=replayIndex;if(replayIndex>=replay.samples.length-1){stopReplay();return;}const gap=(replay.samples[replayIndex+1].at-replay.samples[replayIndex].at)*1000;replayIndex++;replayTimer=setTimeout(step,Math.max(100,Math.min(gap,3000)));};
    $('replay-play').textContent='Pausar';step();
  }
  function download(name,content,type) {
    const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=name.replace(/[^a-zA-Z0-9áéíóúñ._ -]/g,'_');a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function exportCSV(session) {
    const keys=Object.keys(session.samples[0].values);
    const lines=[['frame_time_iso','source',...keys,...keys.map(k=>k+'_received_at_iso')].join(',')];
    for(const sample of session.samples)lines.push([new Date(sample.at*1000).toISOString(),sample.source,...keys.map(k=>sample.values[k]??''),...keys.map(k=>M.finite(sample.received_at?.[k])?new Date(sample.received_at[k]*1000).toISOString():'')].join(','));
    download(session.title+'.csv',lines.join('\n'),'text/csv;charset=utf-8');
  }
  function exportReport(session) {
    const info=experiments[session.kind],points=M.channelPoints(session,info.key),stats=M.statistics(points.map(p=>p.value),session.reference);
    const rows=stats?`<tr><th>Muestras válidas</th><td>${stats.count}</td></tr><tr><th>Promedio</th><td>${fmt(stats.mean,3)} ${info.unit}</td></tr><tr><th>Mínimo / máximo</th><td>${fmt(stats.min,3)} / ${fmt(stats.max,3)}</td></tr><tr><th>σ poblacional</th><td>${fmt(stats.sd,3)}</td></tr><tr><th>Error respecto a referencia</th><td>${fmt(stats.errorPercent,2)} %</td></tr>`:'<tr><td>Sin datos válidos.</td></tr>';
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 560 200');
    drawChart(svg,points.map(p=>[p.at,p.value]),560,200,session.kind==='light');
    const chart=svg.outerHTML;
    const html=`<!doctype html><html lang="es"><meta charset="utf-8"><title>${escape(session.title)}</title><style>body{font:16px system-ui;margin:40px;max-width:900px;color:#18263b}h1{font-size:32px}table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:10px;border-bottom:1px solid #ccd4df}svg{max-width:100%;height:220px}.chart-line{fill:none;stroke:#167c91;stroke-width:2}.chart-grid{stroke:#ccd4df}.chart-dot{fill:#167c91}svg text{fill:#31445e}</style><h1>${escape(session.title)}</h1><p>${escape(info.title)} · ${new Date(session.startedAt).toLocaleString('es')}</p><p>Origen: <b>${session.mode==='live'?'Datos recibidos del ESP32':'Simulación educativa'}</b>. Muestreo por recepción, no captura de laboratorio certificada.</p><h2>Hipótesis</h2><p>${escape(info.hypothesis)}</p><h2>Resultados</h2><table>${rows}</table>${chart}<h2>Ecuaciones</h2><ul>${configs.map(c=>`<li>${escape(c.name)}: ${escape(c.equation)} — ${escape(c.explanation)}</li>`).join('')}</ul><h2>Límites</h2><p>Voltajes, corriente y campo magnético no fueron medidos. El servo registra órdenes, no posición física. MQ-2 sin calibración ni PPM. Las correlaciones no demuestran causalidad. Exporta JSON o CSV para conservar las muestras y tiempos.</p></html>`;
    download(session.title+'.html',html,'text/html;charset=utf-8');
  }
  async function sendServo() {
    if(mode!=='live'||!live?.online||!live.control_enabled)return;
    if(!window.confirm(`Se enviará una orden real de ${servoPreview}° al SG90. ¿El recorrido está libre y deseas continuar?`))return;
    servoSending=true;render();
    try{
      const headers={'Content-Type':'application/json'};
      if(live.source==='mqtt')headers.Authorization='Bearer '+$('physics-servo-token').value;
      const response=await fetch('/api/lab/servo/',{method:'POST',headers,body:JSON.stringify({angle:servoPreview}),signal:AbortSignal.timeout(8000)});
      const result=await response.json();if(!response.ok)throw new Error(result.error||'Orden rechazada.');
      $('physics-servo-status').textContent='Orden enviada; esperando confirmación del firmware. No implica posición física alcanzada.';
    }catch(error){$('physics-servo-status').textContent=error.message;}finally{servoSending=false;render();}
  }
  async function poll() {
    try{
      if(mode==='live'){
        const response=await fetch('/api/physics/telemetry/',{cache:'no-store',signal:AbortSignal.timeout(5000)});
        if(!response.ok)throw new Error('No se pudo consultar la telemetría.');
        live=await response.json();liveError='';
        if(mode==='live'){
          render();capture(live);
          if(live.servo?.status?.includes('confirmada'))$('physics-servo-status').textContent=`${live.servo.status}: ${live.servo.angle}°. Confirmación PWM, no posición física.`;
        }
      }
    }catch(error){liveError=error.message+' Los últimos valores no se consideran actuales.';if(live)live.online=false;render();}
    finally{setTimeout(poll,1000);}
  }

  document.querySelectorAll('[data-tab]').forEach(el=>el.addEventListener('click',()=>tab(el.dataset.tab)));
  $('mode-live').addEventListener('click',()=>setMode('live'));$('mode-sim').addEventListener('click',()=>setMode('sim'));
  $('open-phenomenon').addEventListener('click',()=>tab('phenomena'));
  $('rotate-left').addEventListener('click',()=>{camera.z-=15;updateCamera();});$('rotate-right').addEventListener('click',()=>{camera.z+=15;updateCamera();});
  $('reset-camera').addEventListener('click',()=>{camera={x:48,z:-22,zoom:1};$('scene-zoom').value=100;updateCamera();});
  $('scene-zoom').addEventListener('input',()=>{camera.zoom=Number($('scene-zoom').value)/100;updateCamera();});
  $('scene-view').addEventListener('change',()=>{const val=$('scene-view').value;$('rig').classList.toggle('electric',val==='electric');$('rig').classList.toggle('phenomena',val==='phenomena');$('stage-caption').textContent=val==='electric'?'Alimentación 5 V / 3,3 V y GND: conexiones declaradas. Ni tensión ni corriente medidas.':val==='phenomena'?'Animaciones explicativas del fenómeno. No reproducen la frecuencia de 40 kHz ni miden fuerzas.':'Rutas conceptuales de señal · no representan corriente medida';});
  $('stage').addEventListener('pointerdown',event=>{if(event.button!==0)return;dragging={x:event.clientX,y:event.clientY,cx:camera.x,cz:camera.z,target:event.target.closest('[data-component]')?.dataset.component};dragged=false;$('stage').setPointerCapture(event.pointerId);});
  $('stage').addEventListener('pointermove',event=>{if(!dragging)return;const dx=event.clientX-dragging.x,dy=event.clientY-dragging.y;if(Math.hypot(dx,dy)>5){dragged=true;$('stage').classList.add('dragging');camera.z=dragging.cz+dx*.3;camera.x=Math.max(10,Math.min(75,dragging.cx-dy*.2));updateCamera();}});
  function endDrag(event){const target=dragging?.target;dragging=null;$('stage').classList.remove('dragging');if(event.type==='pointerup'&&target&&!dragged)choose(target);}
  $('stage').addEventListener('pointerup',endDrag);$('stage').addEventListener('pointercancel',endDrag);
  window.addEventListener('resize',updateCamera);
  for(const id of ['vin','r1','r2','divider-select','mq-rl','mq-vrl'])$(id).addEventListener('input',updateCircuit);
  $('reset-divider').addEventListener('click',()=>{$('vin').value=50;$('r1').value=240;$('r2').value=330;updateCircuit();});
  for(const id of ['field','current','field-angle'])$(id).addEventListener('input',updateForce);
  $('signal-channel').addEventListener('change',()=>renderSignals(snapshot()));
  $('experiment-kind').addEventListener('change',experimentInfo);$('record-start').addEventListener('click',startRecording);$('record-stop').addEventListener('click',finishRecording);
  $('export-last').addEventListener('click',()=>{if(lastSession){download(lastSession.title+'.json',JSON.stringify(lastSession,null,2),'application/json');unsaved=false;}});
  $('refresh-history').addEventListener('click',loadHistory);$('replay-play').addEventListener('click',playReplay);$('replay-exit').addEventListener('click',()=>setMode('live'));
  $('replay-position').addEventListener('input',()=>{stopReplay();replayIndex=Number($('replay-position').value);render();});
  document.querySelectorAll('[data-sim]').forEach(el=>el.addEventListener('input',()=>{simValues[el.dataset.sim]=Number(el.value);simulationSample();}));
  for(const [id,key,invert]of [['sim-sound','sound_detected',false],['sim-light','light_gpio_high',true],['sim-gas','mq2_do_high',true]])$(id).addEventListener('change',()=>{simValues[key]=Number(invert?!$(id).checked:$(id).checked);simulationSample();});
  $('physics-servo-angle').addEventListener('input',()=>{servoPreview=Number($('physics-servo-angle').value);previewChanged=true;$('servo-angle-label').textContent=servoPreview+'°';if(mode==='sim')simulationSample();else render();});
  $('physics-servo-send').addEventListener('click',sendServo);
  $('presentation').addEventListener('click',async()=>{try{if(!document.fullscreenElement){await document.documentElement.requestFullscreen();document.body.classList.add('presenting');$('presentation').textContent='Salir';}else await document.exitFullscreen();}catch{document.body.classList.toggle('presenting');$('presentation').textContent=document.body.classList.contains('presenting')?'Salir':'Presentar';}updateCamera();});
  document.addEventListener('fullscreenchange',()=>{if(!document.fullscreenElement){document.body.classList.remove('presenting');$('presentation').textContent='Presentar';}updateCamera();});
  window.addEventListener('beforeunload',event=>{if(recording||unsaved){event.preventDefault();event.returnValue='';}});
  buildModels();experimentInfo();updateCircuit();updateForce();simulationSample();choose(selected);updateCamera();poll();
})();
