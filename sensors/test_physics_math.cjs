const assert = require('node:assert/strict');
const {test} = require('node:test');
const m = require('./static/sensors/physics-math.js');

test('nominal divider and units', () => {
  const d=m.divider(5,240,330);
  assert.ok(Math.abs(d.voltage-2.894736842)<1e-8);
  assert.ok(Math.abs(d.current*1e6-8.771929824)<1e-8);
  assert.ok(Math.abs(d.resistance-138.947368421)<1e-8);
  assert.equal(m.divider(5,0,330),null);
  assert.equal(m.divider(-1,240,330),null);
});
test('derived ECHO, temperature compensation and bounded PWM', () => {
  const u=m.ultrasound(34.3,20);
  assert.ok(Math.abs(u.echoUs-2000)<1e-8);
  assert.ok(Math.abs(u.speed-343.42)<1e-8);
  assert.equal(m.ultrasound(null,20),null);
  assert.equal(m.ultrasound(20,null).corrected,null);
  assert.equal(m.servoPulse(0),1000);
  assert.equal(m.servoPulse(90),1500);
  assert.equal(m.servoPulse(180),2000);
  assert.equal(m.servoPulse(181),null);
  const legacy={min_angle:45,max_angle:135,min_pulse_us:1100,max_pulse_us:1900};
  assert.equal(m.servoPulse(45,legacy),1100);
  assert.equal(m.servoPulse(135,legacy),1900);
});
test('statistics exclude unavailable values instead of converting to zero', () => {
  const s=m.statistics([10,20,30,null,NaN],20);
  assert.equal(s.count,3);assert.equal(s.mean,20);assert.equal(s.errorPercent,0);
  assert.ok(Math.abs(s.sd-Math.sqrt(200/3))<1e-8);
  assert.equal(m.statistics([null,NaN]),null);
  assert.equal(m.force(.2,.08,.02,0),0);
  assert.ok(Math.abs(m.force(.2,.08,.02,90)-.00032)<1e-8);
});
test('digital event frequency is not acoustic frequency; gaps are excluded', () => {
  const frames=[[0,0],[1,1],[2,1],[3,0],[20,1],[21,1]].map(([at,value])=>({at,values:{sound:value}}));
  const t=m.transitions(frames,'sound');
  assert.equal(t.rising,1);
  assert.equal(t.coveredSeconds,4);
  assert.equal(t.activeSeconds,3);
  assert.equal(t.eventsPerMinute,15);
});
test('held values are not counted as new sensor measurements', () => {
  const samples=[
    {at:100,values:{distance:20},received_at:{distance:99}},
    {at:101,values:{distance:20},received_at:{distance:99}},
    {at:102,values:{distance:30},received_at:{distance:102}},
    {at:103,values:{distance:null},received_at:{distance:103}}
  ];
  const points=m.channelPoints({mode:'live',samples},'distance');
  assert.equal(points.length,2);
  assert.equal(m.statistics(points.map(p=>p.value)).mean,25);
  assert.equal(m.channelPoints({mode:'sim',samples},'distance').length,3);
});
