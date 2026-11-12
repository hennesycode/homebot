(function(root) {
  'use strict';
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  function divider(vin, r1, r2) {
    if (![vin,r1,r2].every(finite) || vin < 0 || r1 <= 0 || r2 <= 0) return null;
    return {voltage:vin*r2/(r1+r2), current:vin/((r1+r2)*1000), resistance:r1*r2/(r1+r2)};
  }
  function ultrasound(distance, temperature) {
    if (!finite(distance) || distance < 0) return null;
    const echoUs = 2*distance/0.0343;
    const speed = finite(temperature) ? 331.3+0.606*temperature : null;
    return {echoUs, speed, corrected:speed === null ? null : distance*speed/343};
  }
  function servoPulse(angle) {
    return finite(angle) && angle >= 45 && angle <= 135 ? 1100+(angle-45)*800/90 : null;
  }
  function force(field, current, length, angle) {
    if (![field,current,length,angle].every(finite)) return null;
    return Math.abs(field*current*length*Math.sin(angle*Math.PI/180));
  }
  function statistics(values, reference) {
    const valid = values.filter(finite);
    if (!valid.length) return null;
    const mean = valid.reduce((a,b)=>a+b,0)/valid.length;
    const sd = Math.sqrt(valid.reduce((a,b)=>a+(b-mean)**2,0)/valid.length);
    return {count:valid.length, mean, min:Math.min(...valid), max:Math.max(...valid), sd,
      errorPercent:finite(reference) && reference > 0 ? Math.abs(mean-reference)/reference*100 : null};
  }
  function transitions(samples, key) {
    let previous = null, rising = 0, activeSeconds = 0, coveredSeconds = 0;
    for (const sample of samples) {
      const value = sample.values[key];
      if (!finite(value)) { previous=null; continue; }
      if (previous) {
        const dt = sample.at-previous.at;
        if (dt > 0 && dt <= 6) {
          if (!previous.value && value) rising++;
          if (previous.value) activeSeconds += dt;
          coveredSeconds += dt;
        }
      }
      previous={at:sample.at,value};
    }
    return {rising, activeSeconds, coveredSeconds,
      eventsPerMinute:coveredSeconds ? rising*60/coveredSeconds : null,
      dutyPercent:coveredSeconds ? activeSeconds/coveredSeconds*100 : null};
  }
  function channelPoints(session,key) {
    const seen=new Set(),points=[];
    for (const frame of session.samples) {
      const value=frame.values[key],at=session.mode==='live'?frame.received_at?.[key]:frame.at;
      if (!finite(value)||!finite(at)||seen.has(at)) continue;
      seen.add(at);points.push({at,value,frame});
    }
    return points.sort((a,b)=>a.at-b.at);
  }
  const api = Object.freeze({finite,divider,ultrasound,servoPulse,force,statistics,transitions,channelPoints});
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PhysicsMath = api;
})(globalThis);
