'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {fixture}=require('./support.js');
const {normalize}=require('../scripts/spec.js');
const {stateAt}=require('../scripts/page.js');
const at=seconds=>({seconds});
function scene(t){const f=fixture(t);f.spec.fonts=[f.font];f.spec.cursor={start:{x:10,y:10},moves:[{x:110,y:60,at:at(1)},{x:30,y:80,at:at(1.2)}]};f.spec.camera=[{rect:{x:120,y:50,w:40,h:40},at:at(1)},{rect:'full',at:at(2.5)}];f.spec.clicks=[{at:at(0.8)},{at:at(1.2)}];f.spec.chip={text:'Step',at:at(0.5),until:at(2)};f.spec.callouts=[{rect:{x:100,y:50,w:30,h:30},label:'Here',at:at(0.5),until:at(2)}];return normalize(f.spec).data;}
test('moves arrive on cue frames; travel starts at preceding arrival when later',t=>{const d=scene(t);assert.equal(d.cursor.moves[0].start_frame,3);assert.equal(d.cursor.moves[1].start_frame,30);assert.deepEqual(stateAt(d,3).cursor,{x:10,y:10});assert.deepEqual(stateAt(d,30).cursor,{x:110,y:60});assert.deepEqual(stateAt(d,36).cursor,{x:30,y:80});assert.deepEqual(stateAt(d,16.5).cursor,{x:60,y:35});});
test('appearances are visible first on their frame and until starts fade-out there',t=>{const d=scene(t);assert.equal(stateAt(d,14).chip,0);assert.ok(stateAt(d,15).chip>0);assert.equal(stateAt(d,14).callouts[0],0);assert.ok(stateAt(d,15).callouts[0]>0);assert.ok(stateAt(d,60).chip<stateAt(d,59).chip);assert.equal(stateAt(d,69).chip,0);assert.equal(stateAt(d,23).clicks[0].opacity,0);assert.ok(stateAt(d,24).clicks[0].opacity>0);});
test('click center stays at click-time position while cursor travels',t=>{const d=scene(t),first=stateAt(d,24).clicks[0];const later=stateAt(d,28).clicks[0];assert.equal(first.x,later.x);assert.equal(first.y,later.y);assert.notEqual(stateAt(d,28).cursor.x,first.x);});
test('camera fits and bounds edges on every interpolated frame; full returns centered',t=>{const d=scene(t);for(let i=0;i<150;i++){const {k,x,y}=stateAt(d,i).camera;const w=d.still.width*k,h=d.still.height*k;if(w>=d.width){assert.ok(x<=1e-9);assert.ok(x+w>=d.width-1e-9);}else assert.ok(Math.abs(x-(d.width-w)/2)<1e-9);if(h>=d.height){assert.ok(y<=1e-9);assert.ok(y+h>=d.height-1e-9);}else assert.ok(Math.abs(y-(d.height-h)/2)<1e-9);}assert.deepEqual(stateAt(d,75).camera,{k:2,x:0,y:0});});
test('state is independent of seeks in shuffled order',t=>{const d=scene(t),expected=stateAt(d,27);for(const i of [149,0,75,24,1,45,6])stateAt(d,i);assert.deepEqual(stateAt(d,27),expected);});
