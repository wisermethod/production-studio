'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {fixture,ok,refused,tree}=require('./support.js');
const {milliseconds,stamp}=require('../scripts/srt.js');
const {rational:q}=require('../scripts/rational.js');
const cue='1\n00:00:00,100 --> 00:00:00,433\nOne line.\n\n';
function setup(t){const f=fixture(t);f.srt=path.join(f.dir,'scene.srt');fs.writeFileSync(f.srt,cue);f.list=[{srt:f.srt,start:0},{srt:f.srt,start:1.0005}];f.out=path.join(f.dir,'joined.srt');return f;}
function args(f){return ['captions','--list',f.save(f.list,'list.json'),'--output',f.out];}
test('join offsets exactly, rounds half milliseconds up and renumbers',t=>{
  const f=setup(t);const r=ok(args(f));assert.equal(r.cues,2);
  assert.equal(fs.readFileSync(f.out,'utf8'),cue+'2\n00:00:01,101 --> 00:00:01,434\nOne line.\n\n');
  assert.equal(stamp(360000123n),'100:00:00,123');assert.equal(milliseconds(q('4.1005')),4101n);
});
for(const [name,change,pattern]of [
 ['overlap',f=>f.list[1].start=0.2,/overlap/],['offset order',f=>f.list.reverse(),/order/],['negative offset',f=>f.list[0].start=-1,/nonnegative/],['unknown item key',f=>f.list[0].extra=1,/unknown key/],['list not array',f=>f.list={},/list/],['missing srt',f=>delete f.list[0].srt,/missing/],['missing start',f=>delete f.list[0].start,/missing/],['relative srt',f=>f.list[0].srt='relative.srt',/absolute/],['invalid stamp',f=>fs.writeFileSync(f.srt,cue.replace(',100','.100')),/invalid SRT/],['invalid number',f=>fs.writeFileSync(f.srt,cue.replace(/^1/,'2')),/invalid SRT/],['reverse cue',f=>fs.writeFileSync(f.srt,cue.replace(',433',',099')),/overlap|order/],['overlapping source',f=>fs.writeFileSync(f.srt,cue+cue.replace(/^1/,'2')),/overlap/],['missing text',f=>fs.writeFileSync(f.srt,'1\n00:00:00,000 --> 00:00:01,000\n\n'),/invalid SRT/]
])test(`captions refusal ${name} writes nothing`,t=>{const f=setup(t);change(f);const a=args(f),before=tree(f.dir);refused(a,pattern);assert.deepEqual(tree(f.dir),before);});
test('empty list and empty SRT give an empty new file',t=>{const f=setup(t);f.list=[];assert.equal(ok(args(f)).cues,0);assert.equal(fs.readFileSync(f.out,'utf8'),'');fs.writeFileSync(f.srt,'');f.list=[{srt:f.srt,start:0}];f.out=path.join(f.dir,'empty.srt');assert.equal(ok(args(f)).cues,0);});
test('adjacent cues allowed; existing destination refused and preserved',t=>{const f=setup(t);f.list[1].start=0.333;ok(args(f));const before=tree(f.dir);refused(args(f),/exists/);assert.deepEqual(tree(f.dir),before);});
