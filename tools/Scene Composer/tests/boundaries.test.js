'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {fixture,ok,refused,tree}=require('./support.js');
const {compose,captions}=require('../scripts/compose.js');
const {normalize,image}=require('../scripts/spec.js');
const at=seconds=>({seconds});
function drawn(f){f.spec.fonts=[f.font];f.spec.captions={mode:'drawn',lines:[{text:'Open',at:{word:'Open',occurrence:1}}],style:{font:'Local',size:18,weight:400,color:'#fff',background:'none',padding:4,radius:3,position:'bottom',margin:8,max_width:300}};return f.spec.captions.style;}
for(const [key,value]of [['font','Unknown'],['size',0],['weight',1001],['color','red'],['background','url(file)'],['padding',-1],['radius',-1],['position','center'],['margin',90],['max_width',321]]){
  test(`drawn style ${key} invalid writes nothing`,t=>{const f=fixture(t);drawn(f)[key]=value;const input=f.save(),before=tree(f.dir);refused(['compose','--spec',input,'--output',f.output],/Correct/);assert.deepEqual(tree(f.dir),before);});
}
for(const key of ['font','size','weight','color','background','padding','radius','position','margin','max_width']){
  test(`drawn style ${key} required`,t=>{const f=fixture(t);delete drawn(f)[key];const input=f.save(),before=tree(f.dir);refused(['compose','--spec',input,'--output',f.output],new RegExp('missing field captions.style.'+key));assert.deepEqual(tree(f.dir),before);});
}
for(const key of ['lead','tail','fonts','colors','chip','cursor','clicks','camera','callouts','captions']){
  test(`explicit null is refused for ${key}`,t=>{const f=fixture(t);f.spec[key]=null;const input=f.save(),before=tree(f.dir);refused(['compose','--spec',input,'--output',f.output],/Correct/);assert.deepEqual(tree(f.dir),before);});
}
test('JPEG dimensions come from SOF, not extension; truncated headers refused',()=>{
  const jpeg=Buffer.from([255,216,255,224,0,4,0,0,255,192,0,11,8,0,90,0,160,1,1,17,0,255,217]);
  assert.deepEqual(image(jpeg),{width:160,height:90,extension:'jpg'});
  assert.throws(()=>image(jpeg.subarray(0,16)),/PNG or JPEG/);
});
test('moves can set initial state at frame zero and equal-kind appearances may coexist',t=>{
  const f=fixture(t);f.spec.cursor={start:{x:0,y:0},moves:[{x:10,y:10,at:at(0)}]};f.spec.clicks=[{at:at(0)},{at:at(0)}];
  const r=normalize(f.spec);assert.equal(r.data.cursor.moves[0].start_frame,0);assert.equal(r.data.clicks.length,2);
});
test('move arrival collision is refused before writes',t=>{
  const f=fixture(t);f.spec.camera=[{rect:'full',at:at(0.001)},{rect:'full',at:at(0.002)}];
  const input=f.save(),before=tree(f.dir);refused(['compose','--spec',input,'--output',f.output],/distinct/);assert.deepEqual(tree(f.dir),before);
});
test('appearance at scene end is an endpoint; a caption there is refused',t=>{
  const f=fixture(t);delete f.spec.take;f.spec.duration=1;f.spec.camera=[{rect:'full',at:at(1)}];
  assert.equal(normalize(f.spec).events[0].frame,30);
  f.spec.captions={lines:[{text:'Too late',at:at(1)}]};const input=f.save(),before=tree(f.dir);refused(['compose','--spec',input,'--output',f.output],/no frames/);assert.deepEqual(tree(f.dir),before);
});
test('sub-millisecond SRT collapse refused before output',t=>{
  const f=fixture(t);delete f.spec.take;f.spec.duration=0.0002;f.spec.frame.fps=10000;f.spec.captions={lines:[{text:'Fast',at:at(0)}]};
  const input=f.save(),before=tree(f.dir);refused(['compose','--spec',input,'--output',f.output],/empty after millisecond/);assert.deepEqual(tree(f.dir),before);
});
test('write failure rolls back all compose output and leaves inputs untouched',t=>{
  const f=fixture(t),input=f.save(),before=tree(f.dir),write=fs.writeFileSync;
  try{let n=0;fs.writeFileSync=function(...args){if(String(args[0]).startsWith(f.output)&&++n===3){const e=new Error('planted');e.code='EIO';throw e;}return write.apply(this,args);};assert.throws(()=>compose(input,f.output),/EIO/);}finally{fs.writeFileSync=write;}
  assert.deepEqual(tree(f.dir),before);
});
test('captions write failure removes only its newly created file',t=>{
  const f=fixture(t),input=f.save([],'list.json'),dest=path.join(f.dir,'new.srt'),before=tree(f.dir),write=fs.writeFileSync;
  try{fs.writeFileSync=function(file,...args){if(typeof file==='number'){const e=new Error('planted');e.code='EIO';throw e;}return write.call(this,file,...args);};assert.throws(()=>captions(input,dest),/EIO/);}finally{fs.writeFileSync=write;}
  assert.deepEqual(tree(f.dir),before);
});
test('captions preserve spaces and Unicode through join',t=>{
  const f=fixture(t),srt=path.join(f.dir,'source.srt'),dest=path.join(f.dir,'new.srt');
  const source='1\n00:00:00,000 --> 00:00:01,000\n  Caf\u00e9 literal <tag>.  \n\n';fs.writeFileSync(srt,source);
  ok(['captions','--list',f.save([{srt,start:0}],'list.json'),'--output',dest]);assert.equal(fs.readFileSync(dest,'utf8'),source);
});
test('ignored take metadata has no effect on project or record bytes',t=>{
  const f=fixture(t);const input=f.save();ok(['compose','--spec',input,'--output',f.output]);
  f.record.ignored={other:'changed metadata'};f.save(f.record,'take.json');const other=path.join(f.dir,'other');ok(['compose','--spec',input,'--output',other]);assert.deepEqual(tree(f.output),tree(other));
});
test('default fade lengths are exact at a decimal product boundary',t=>{
  const f=fixture(t);f.spec.frame.fps=100;assert.equal(normalize(f.spec).data.fades.callout,35);assert.equal(normalize(f.spec).data.fades.ripple,8);
});
