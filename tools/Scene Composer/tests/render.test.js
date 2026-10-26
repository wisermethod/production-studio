'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {fixture,ok}=require('./support.js');
const renderer=process.env.SCENE_COMPOSER_VIDEO_RENDER;
const assets=process.env.SCENE_COMPOSER_TEST_ASSETS;
function render(args){const r=spawnSync(process.execPath,[renderer,...args],{encoding:'utf8',timeout:240000,maxBuffer:8*1024*1024});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);}
test('video-render: intermediate MP4, identical sequences on one worker and three, selected frames', {skip:!renderer?'SCENE_COMPOSER_VIDEO_RENDER unset; renderer integration not run':false,timeout:240000},t=>{
  const f=fixture(t);delete f.spec.take;f.spec.duration=1;f.spec.frame.fps=10;
  f.spec.cursor={start:{x:5,y:5},moves:[{x:90,y:60,at:{seconds:0.4}}]};
  f.spec.clicks=[{at:{seconds:0.4}}];f.spec.camera=[{rect:{x:60,y:35,w:60,h:45},at:{seconds:0.8}}];
  if(assets){f.spec.fonts=[{family:'Local',path:path.join(assets,'font.woff2')}];f.spec.chip={text:'Open the folder',at:{seconds:0},until:{seconds:0.8}};f.spec.callouts=[{rect:{x:60,y:35,w:30,h:20},label:'Pick here',at:{seconds:0.2},until:{seconds:0.7}}];f.spec.captions={mode:'drawn',lines:[{text:'Open the folder.',at:{seconds:0.1}}],style:{font:'Local',size:16,weight:400,color:'#fff',background:'#111e',padding:4,radius:4,position:'bottom',margin:6,max_width:290}};}
  const composed=ok(['compose','--spec',f.save(),'--output',f.output]);
  const common=['--project',path.join(f.output,'project'),'--width','320','--height','180','--fps','10','--duration',String(composed.duration),'--workers','1'];
  const a=render(['sequence',...common,'--output',path.join(f.dir,'sequence-a')]);
  const b=render(['sequence',...common,'--output',path.join(f.dir,'sequence-b')]);
  assert.equal(a.frameCount,10);assert.equal(b.frameCount,10);
  assert.deepEqual(fs.readFileSync(a.hashesPath),fs.readFileSync(b.hashesPath));
  // Split across workers, each starting fresh partway through a fade, the frames must not change.
  const c=render(['sequence',...common.slice(0,-1),'3','--output',path.join(f.dir,'sequence-c')]);
  assert.deepEqual(fs.readFileSync(c.hashesPath),fs.readFileSync(a.hashesPath),'three workers drew different frames from one');
  const hashes=fs.readFileSync(a.hashesPath,'utf8').trim().split('\n').map(line=>line.split(/\s+/)[0]);assert.ok(new Set(hashes).size>1,'motion must change pixels');
  const mp4=render(['render',...common,'--output',path.join(f.dir,'scene.mp4'),'--profile','intermediate']);assert.equal(mp4.frameCount,10);
  const stills=render(['frames',...common,'--output',path.join(f.dir,'selected'),'--times','0,0.4,0.8']);assert.equal(stills.frames.length,3);
});
test('supplied aligned take, real product still and OFL font compose', {skip:!assets?'SCENE_COMPOSER_TEST_ASSETS unset; supplied-asset check not run':false},t=>{
  const f=fixture(t);f.spec.still.path=path.join(assets,'still.png');f.spec.take.record=path.join(assets,'take.json');f.spec.fonts=[{family:'Archivo',path:path.join(assets,'font.woff2')}];
  f.spec.chip={text:'Folder walkthrough',at:{word:'Open',occurrence:1},until:{word:'Close',occurrence:1}};
  f.spec.captions={lines:[{text:'Open the folder you made.',at:{word:'Open',occurrence:1}},{text:'Pick the file named notes.',at:{word:'Pick',occurrence:1}},{text:'Read the first line out loud.',at:{word:'Read',occurrence:1}},{text:'Close the folder when you finish.',at:{word:'Close',occurrence:1}}]};
  const r=ok(['compose','--spec',f.save(),'--output',f.output]);assert.equal(r.captions.length,4);assert.ok(r.frames>100);
});
