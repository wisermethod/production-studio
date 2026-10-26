'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const zlib = require('node:zlib');
const { spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');
const TOOL = path.resolve(__dirname, '..'), ENTRY = path.join(TOOL, 'scripts/scene-composer.js');
function crc(data) {
  let c = -1;
  for (const b of data) { c ^= b; for (let i=0;i<8;i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
  return (c ^ -1) >>> 0;
}
function png(w=160,h=90) {
  function chunk(name,data) {
    const size=Buffer.alloc(4), tag=Buffer.from(name), sum=Buffer.alloc(4);
    size.writeUInt32BE(data.length); sum.writeUInt32BE(crc(Buffer.concat([tag,data])));
    return Buffer.concat([size,tag,data,sum]);
  }
  const header=Buffer.alloc(13); header.writeUInt32BE(w); header.writeUInt32BE(h,4); header[8]=8; header[9]=2;
  const pixels=Buffer.alloc(h*(1+w*3));
  for(let y=0;y<h;y++) for(let x=0;x<w;x++) {
    const i=y*(1+w*3)+1+x*3; pixels[i]=x%256; pixels[i+1]=y%256; pixels[i+2]=x<80?220:40;
  }
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
}
function fixture(t) {
  const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'scene-composer-test-')));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  fs.writeFileSync(path.join(dir,'still.png'),png());
  fs.writeFileSync(path.join(dir,'font.woff2'),Buffer.concat([Buffer.from('wOF2'),Buffer.alloc(16)]));
  const record={timings:[{text:'Open',start:0.1,end:0.4},{text:'Save.',start:0.5,end:0.8},{text:'Save.',start:4.1,end:4.3}],aligned_file:{sample_count:240000},delay:{sample_rate:48000},ignored:'not consumed'};
  fs.writeFileSync(path.join(dir,'take.json'),JSON.stringify(record));
  const spec={frame:{width:320,height:180,fps:30},still:{path:path.join(dir,'still.png')},take:{record:path.join(dir,'take.json')},lead:0,tail:0};
  return {dir,spec,record,output:path.join(dir,'out'),font:{family:'Local',path:path.join(dir,'font.woff2')},save(value=spec,name='spec.json'){const p=path.join(dir,name);fs.writeFileSync(p,JSON.stringify(value));return p;}};
}
const call=args=>spawnSync(process.execPath,[ENTRY,...args],{encoding:'utf8',timeout:30000});
function ok(args){const r=call(args);assert.equal(r.status,0,r.stderr);assert.equal(r.stderr,'');return JSON.parse(r.stdout);}
function refused(args,pattern){const r=call(args);assert.equal(r.status,1,r.stderr);assert.equal(r.stdout,'');assert.match(r.stderr,pattern);return r;}
function tree(dir){return fs.readdirSync(dir,{recursive:true}).sort().map(p=>{const f=path.join(dir,p);return [p,fs.statSync(f).isFile()?fs.readFileSync(f).toString('base64'):null];});}
module.exports={fixture,call,ok,refused,tree,png,TOOL,ENTRY};
