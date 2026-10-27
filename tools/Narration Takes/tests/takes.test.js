'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const {spawnSync} = require('node:child_process');
const I = require('../scripts/io.js');
const M = require('../scripts/model.js');
const T = require('../scripts/takes.js');
const {run} = require('../scripts/narration-takes.js');
const {fs,path} = I;
const FIXTURE = path.join(__dirname,'fixtures/gapless.mp3');
const ID = '00000000-0000-4000-8000-000000000001';
function write(file,value) { fs.writeFileSync(file,I.encode(value)); return file; }
function wav(file, bits=16, rate=24000, samples=24000, channels=1) {
  const bytes = samples*channels*bits/8, b=Buffer.alloc(44+bytes);
  b.write('RIFF'); b.writeUInt32LE(36+bytes,4); b.write('WAVEfmt ',8); b.writeUInt32LE(16,16);
  b.writeUInt16LE(1,20); b.writeUInt16LE(channels,22); b.writeUInt32LE(rate,24);
  b.writeUInt32LE(rate*channels*bits/8,28); b.writeUInt16LE(channels*bits/8,32); b.writeUInt16LE(bits,34);
  b.write('data',36); b.writeUInt32LE(bytes,40); fs.writeFileSync(file,b); return file;
}
function preparation(text,route) {
  const tokens=M.scriptTokens(text), submitted=text, correspondence=[]; let offset=0;
  tokens.forEach((token,i)=>{
    const unitStart=submitted.indexOf(token,offset), start=[...submitted.slice(0,unitStart)].length, end=start+[...token].length;
    correspondence.push({script_index:i,script_token:token,route_word:token,route_start:start,route_end:end,spoken_start:start,spoken_end:end}); offset=unitStart+token.length;
  });
  const form={text,code_points:[...text].length,sha256:I.hash(Buffer.from(text))};
  return {version:1,route,script:form,submitted:form,tokens,words:tokens,correspondence};
}
function fixture(t,route='chatterbox',text='New board.') {
  const temp=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'narration-takes-test-')));
  t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
  const production=path.join(temp,'production'); fs.mkdirSync(production);
  let source;
  if (route==='elevenlabs') { const outputs=path.join(temp,'gateway','outputs'); fs.mkdirSync(outputs,{recursive:true}); source=path.join(outputs,ID+'.mp3'); fs.copyFileSync(FIXTURE,source); }
  else source=wav(path.join(temp,'source.wav'),24);
  const st=T.stage({production,scene:'scene',route,source,...I.identity(source)});
  const dir=path.dirname(st.source), aligned=path.join(dir,st.cid+'.wav');
  const src=M.sourceClock(st.source), samples=route==='elevenlabs' ? 4410 : 24000;
  wav(aligned,16,src.rate,samples,src.channels);
  const a=I.identity(aligned);
  const descriptor={ok:true,usable:true,basis:src.basis,removed:src.removed,stated:src.stated,rate:src.rate,channels:src.channels,codec:'pcm_s16le',time_base:'1/'+src.rate,sample_count:samples,...a,output:aligned,source:{path:st.source,before:st.file,after:st.file}};
  const settings={device:'mps',exaggeration:0.7,cfg_weight:0.3,seed:20261026,seed_step:1,max_words:35,trim_db:-50,mark_gap_s:0.5,sentence_gap_s:0.3,repetition_penalty:1.2,min_p:0.05,top_p:1,temperature:0.8};
  const facts=route==='elevenlabs' ? {voice_id:'voice',model_id:'eleven_v4'} : {reference_sha256:'a'.repeat(64),settings};
  const prep=preparation(text,route), length=samples/src.rate;
  const timings=prep.tokens.map((token,i)=>({text:token,start:i*length/prep.tokens.length,end:(i+1)*length/prep.tokens.length}));
  const transcript=path.join(dir,'transcript.txt'); fs.writeFileSync(transcript,'Transcribed speech: New board.\n');
  const o={production,stage:write(path.join(temp,'stage.json'),st),prepared:write(path.join(temp,'prepared.json'),prep),pcm:write(path.join(temp,'pcm.json'),descriptor),timings:write(path.join(temp,'timings.json'),timings),call:write(path.join(temp,'call.json'),{action:route==='elevenlabs'?'elevenlabs.speech.synthesize':'chatterbox.synthesize',inputs:facts}),check:write(path.join(temp,'check.json'),{result:'pass',transcript:'transcript.txt'})};
  const result=T.file(o), record=result.record;
  const registry=path.join(production,'narration','narration.json');
  const current={production,record,settings:write(path.join(temp,'settings.json'),{route,language:'en',...facts}),expected:write(path.join(temp,'prior.json'),null)};
  return {temp,production,st,dir,aligned,o,record,registry,current,source};
}
function mutate(f,fn) { const r=I.json(f.record); fn(r); write(f.record,r); }
function valid(f) { return T.validate({production:f.production,record:f.record}); }

test('help before dependency checks, closed flags and stdout/stderr discipline',()=>{
  for(const args of [['help'],['--help'],['stage','--help'],['current','-h']]) assert.match(run(args),/Narration Takes 0.1.0/);
  for(const args of [[],['bogus'],['help','--install'],['stage','--install'],['stage','--env','/abs/key'],['stage','--wat'],['stage','--source','a','--source','b']]) assert.throws(()=>run(args));
  const result=spawnSync(process.execPath,[path.join(__dirname,'../scripts/narration-takes.js'),'stage','--install'],{encoding:'utf8'});
  assert.equal(result.status,1); assert.equal(result.stdout,''); assert.match(result.stderr,/unknown flag --install/);
  assert.equal(spawnSync(process.execPath,['-e','require('+JSON.stringify(path.join(__dirname,'../scripts/narration-takes.js'))+')'],{encoding:'utf8'}).stdout,'');
});
test('strict parser refuses duplicate escaped keys, nonfinite, malformed JSON',()=>{
  for(const s of ['{"a":1,"\\u0061":2}','{"a":{"b":1,"b":2}}','{"a":1e999}','{"a":NaN}','{"a":Infinity}','{"a":1,}','[true,]','{} false','{"a":"\u0001"}']) assert.throws(()=>I.parse(s));
  assert.equal(I.parse('{"a":2}').a,2);
});
test('local stage keeps original, generates UUID; both routes file, validate and promote',t=>{
  for(const route of ['chatterbox','elevenlabs']) {
    const f=fixture(t,route); assert.equal(fs.existsSync(f.source),route==='chatterbox');
    M.cid(f.st.cid); assert.equal(valid(f).eligible,true);
    T.current(f.current); assert.equal(I.json(f.registry).scenes.scene.cid,f.st.cid);
    assert.equal(I.json(f.registry).settings.language,'en');
  }
});
test('failed and unfinished checks remain valid evidence, preserving earlier pointer and transcript',t=>{
  const f=fixture(t); T.current(f.current); const prior=I.read(f.registry);
  fs.writeFileSync(f.current.expected,prior);
  const oldRecord=f.record, newId=I.crypto.randomUUID(), next=I.json(oldRecord);
  next.cid=newId;next.aligned_file.name=newId+'.wav';
  fs.copyFileSync(f.st.source,path.join(f.dir,newId+'.source.wav'));
  fs.copyFileSync(f.aligned,path.join(f.dir,newId+'.wav'));
  f.record=write(path.join(f.dir,newId+'.json'),next);f.current.record=f.record;
  const oldBytes=I.read(oldRecord);
  for(const state of ['fail','absent']) {
    mutate(f,r=>{ if(state==='fail') r.check.result='fail'; else delete r.check; });
    const result=validEvidence(f); assert.equal(result.valid,true); assert.equal(result.eligible,false);
    assert.throws(()=>T.current(f.current),/ineligible/);
    assert.deepEqual(I.read(f.registry),prior); assert.equal(fs.existsSync(path.join(f.dir,'transcript.txt')),true);
    assert.deepEqual(I.read(oldRecord),oldBytes);
  }
});
// Read evidence without a current registry settings comparison.
function validEvidence(f) { return M.validateRecord(f.production,f.record); }
test('completion adds only caller check without synthesis and refuses changed evidence or prior bytes',t=>{
  const f=fixture(t); mutate(f,r=>delete r.check);
  const prior=I.read(f.record); const expected=path.join(f.temp,'old-take.json'); fs.writeFileSync(expected,prior);
  const before=I.json(f.record).date_filed;
  assert.equal(T.file({...f.o,expected}).eligible,true); assert.equal(I.json(f.record).date_filed,before);
  assert.throws(()=>T.file({...f.o,expected}),/expected prior/);
  assert.throws(()=>T.file(f.o),/already exists/);
  assert.throws(()=>T.file({...f.o,expected:f.record}),/separate prior snapshot/);
  fs.writeFileSync(expected,I.read(f.record)); write(f.o.check,{result:'fail',transcript:'transcript.txt'});
  assert.throws(()=>T.file({...f.o,expected}),/change existing/);
});
test('changed prior registry and byte-only changes refuse, unrelated scenes retained',t=>{
  const f=fixture(t); T.current(f.current);
  assert.throws(()=>T.current({...f.current,expected:f.registry}),/separate prior snapshot/);
  let reg=I.json(f.registry); reg.scenes.other={cid:ID}; write(f.registry,reg);
  assert.throws(()=>T.current(f.current),/expected prior/);
  fs.writeFileSync(f.current.expected,I.read(f.registry)); T.current(f.current);
  assert.equal(I.json(f.registry).scenes.other.cid,ID);
  fs.writeFileSync(f.current.expected,I.read(f.registry)); fs.appendFileSync(f.registry,'\n');
  assert.throws(()=>T.current(f.current),/expected prior/);
});
test('non-English explicit unchecked may be current; English unchecked refuses',t=>{
  const f=fixture(t,'elevenlabs'); mutate(f,r=>r.check={result:'unchecked',language:'fr'});
  const s=I.json(f.current.settings); s.language='fr'; write(f.current.settings,s);
  assert.equal(valid(f).eligible,true); T.current(f.current);
  mutate(f,r=>r.check.language='en-US'); assert.throws(()=>validEvidence(f),/English cannot/);
});

const DEFECTS = {
  'added key':r=>r.extra=true,
  'token case NEW for New':r=>r.timings[0].text='NEW',
  'text hash':r=>r.text_sha256='f'.repeat(64),
  'address in inputs':r=>r.inputs.endpoint='https://invalid.example/speech',
  'vendor body':r=>r.inputs.body={},
  'boolean samples':r=>r.aligned_file.sample_count=true,
  'nonfinite samples':r=>r.aligned_file.sample_count=Infinity,
  'boolean removed samples':r=>r.delay.samples_removed=false,
  'boolean bytes':r=>r.file.bytes=true,
  'source hash':r=>r.file.sha256='f'.repeat(64),
  'WAV hash':r=>r.aligned_file.sha256='f'.repeat(64),
  'clock rate':r=>r.delay.sample_rate=44100,
  'sample count':r=>r.aligned_file.sample_count++,
  'word past take':r=>r.timings[1].end=2,
  'negative word':r=>r.timings[0].start=-1,
  'word reversed':r=>r.timings[0].start=0.75,
  'missing word':r=>r.timings.pop(),
  'reordered words':r=>r.timings.reverse(),
  'wrong duration':r=>r.duration=2,
  'wrong action':r=>r.action='xai.speech.synthesize',
  'wrong scene':r=>r.scene='other',
  'wrong cid':r=>r.cid=ID,
  'wrong route':r=>r.route='xai',
  'wrong filename':r=>r.aligned_file.name='../elsewhere.wav',
  'missing transcript key':r=>delete r.check.transcript,
  'transcript traversal':r=>r.check.transcript='../transcript.txt',
  'extra check key':r=>r.check.confidence=1,
  'invalid check state':r=>r.check.result='pending',
  'aligned without delay':r=>delete r.delay,
  'wrong delay':r=>r.delay.samples_removed=1105,
  'boolean characters':r=>r.characters=true,
  'characters over limit':r=>r.characters=5001,
  'bad date':r=>r.date_filed='2026-02-30'
};
for(const [name,defect] of Object.entries(DEFECTS)) test('validate refuses '+name,t=>{
  const f=fixture(t); mutate(f,defect); assert.throws(()=>valid(f));
});
test('validate refuses raw non-finite and duplicate record keys',t=>{
  const f=fixture(t); const old=I.read(f.record).toString();
  fs.writeFileSync(f.record,old.replace('"sample_count": 24000','"sample_count": 1e999')); assert.throws(()=>valid(f),/non-finite/);
  fs.writeFileSync(f.record,old.replace('"scene": "scene",','"scene": "scene", "scene":"scene",')); assert.throws(()=>valid(f),/duplicate/);
});
test('validate refuses missing, empty and escaped transcript files',t=>{
  const f=fixture(t), transcript=path.join(f.dir,'transcript.txt');
  fs.writeFileSync(transcript,''); assert.throws(()=>valid(f));
  fs.unlinkSync(transcript); assert.throws(()=>valid(f));
  const outside=path.join(f.temp,'outside.txt'); fs.writeFileSync(outside,'text'); fs.symlinkSync(outside,transcript); assert.throws(()=>valid(f));
});
test('validate refuses non-16-bit PCM even when forged hash/size match',t=>{
  const f=fixture(t); wav(f.aligned,24);
  mutate(f,r=>Object.assign(r.aligned_file,I.identity(f.aligned))); assert.throws(()=>valid(f),/16-bit PCM/);
});
test('changed source or WAV bytes refuse and leave pointer untouched',t=>{
  for(const which of ['source','aligned']) {
    const f=fixture(t); T.current(f.current); const prior=I.read(f.registry);
    fs.appendFileSync(which==='source'?f.st.source:f.aligned,'x');
    assert.throws(()=>valid(f),/mismatch/); assert.throws(()=>T.current(f.current)); assert.deepEqual(I.read(f.registry),prior);
  }
});
test('incomplete delay remains evidence, cannot be current, no pointer is created',t=>{
  const f=fixture(t); mutate(f,r=>{delete r.delay;delete r.aligned_file;});
  assert.equal(valid(f).eligible,false); assert.throws(()=>T.current(f.current),/ineligible/); assert.equal(fs.existsSync(f.registry),false);
});
test('unknown MP3 delay remains evidence and cannot be current',t=>{
  const f=fixture(t,'elevenlabs');
  // Remove the Xing/Info header marker from the committed silent fixture and
  // the LAME signature, retaining MP3 frames readable by ffprobe.
  const bytes=I.read(f.st.source);
  for(const marker of ['Xing','Info','LAME']) { let i; while((i=bytes.indexOf(marker))>=0) bytes.fill(0,i,i+marker.length); }
  fs.writeFileSync(f.st.source,bytes);
  assert.equal(M.sourceClock(f.st.source).basis,'unknown');
  mutate(f,r=>{r.file=I.identity(f.st.source);r.delay={samples_removed:0,sample_rate:44100,basis:'unknown',stated_skip_samples:null};r.aligned_file=null;});
  assert.equal(valid(f).eligible,false); assert.throws(()=>T.current(f.current),/ineligible/);
});
test('legacy headerless LAME clock reads back 1105 removed, without rescaling',t=>{
  const f=fixture(t,'elevenlabs');fs.writeFileSync(f.st.source,I.read(f.st.source).subarray(417));
  const src=M.sourceClock(f.st.source);assert.equal(src.basis,'lame_no_header');assert.equal(src.rate,44100);assert.equal(src.removed,1105);
  mutate(f,r=>{r.file=I.identity(f.st.source);r.delay={samples_removed:1105,sample_rate:44100,basis:'lame_no_header',stated_skip_samples:null};});
  assert.equal(valid(f).eligible,true);
  mutate(f,r=>r.delay.samples_removed=1203);assert.throws(()=>valid(f),/delay differs/);
});
test('legacy xAI record and registry validate without rewriting their bytes',t=>{
  const f=fixture(t,'elevenlabs');
  mutate(f,r=>{delete r.route;r.action='xai.speech.synthesize';r.inputs={voice_id:'old-voice',language:'en',timings:'words',text_normalization:false};r.characters=[...r.text].length;r.duration=0.25;});
  write(f.registry,{settings:{voice_id:'old-voice',language:'en',text_normalization:false},scenes:{scene:{cid:f.st.cid}}});
  const before=I.read(f.record), registry=I.read(f.registry);
  assert.equal(valid(f).legacy,true); assert.deepEqual(I.read(f.record),before); assert.deepEqual(I.read(f.registry),registry);
  const expected=path.join(f.temp,'legacy.json'); fs.writeFileSync(expected,before);
  assert.throws(()=>T.file({...f.o,expected}),/legacy takes/);
});
test('5,000-code-point original and submitted boundaries, including astral characters',t=>{
  const f=fixture(t,'elevenlabs','𐐀'.repeat(5000)); assert.equal(valid(f).eligible,true);
  mutate(f,r=>{r.text+='𐐀';r.text_sha256=I.hash(Buffer.from(r.text));}); assert.throws(()=>valid(f),/5,000/);
  const p=I.json(f.o.prepared); p.submitted.text+='𐐀';p.submitted.code_points++;p.submitted.sha256=I.hash(Buffer.from(p.submitted.text)); write(f.o.prepared,p);
  assert.throws(()=>T.file(f.o),/5,000/);
});
test('settings mismatch, strict registry and stale lock refuse',t=>{
  const f=fixture(t); const s=I.json(f.current.settings); s.reference_sha256='b'.repeat(64); write(f.current.settings,s);
  assert.throws(()=>T.current(f.current),/settings differ/);
  write(f.registry,{settings:{},scenes:{}}); assert.throws(()=>valid(f));
  fs.mkdirSync(path.join(f.production,'narration','.narration-takes.lock'));
  assert.throws(()=>T.current(f.current),/lock exists/);
});
test('stage refuses paths, links, sizes, hashes, scene ids, gateway containment and existing destinations',t=>{
  const f=fixture(t,'elevenlabs'), outputs=path.join(f.temp,'gateway','outputs');
  fs.copyFileSync(FIXTURE,f.source); const id=I.identity(f.source);
  const o={production:f.production,scene:'scene',route:'elevenlabs',source:f.source,...id};
  assert.throws(()=>T.stage(o),/already exists/); assert.equal(fs.existsSync(f.source),true);
  for(const change of [{scene:'../bad'},{scene:'UPPER'},{scene:''},{cid:'bad'},{cid:'11111111-1111-4111-8111-111111111111'},{route:'xai'},{bytes:id.bytes+1},{sha256:'f'.repeat(64)},{source:'relative.mp3'},{source:outputs+'/../outputs/'+ID+'.mp3'},{production:path.dirname(outputs)}]) assert.throws(()=>T.stage({...o,scene:'fresh',...change}));
  const outside=path.join(f.temp,'not-outputs'); fs.mkdirSync(outside);
  const wrong=path.join(outside,ID+'.mp3');fs.copyFileSync(FIXTURE,wrong);assert.throws(()=>T.stage({...o,source:wrong}));
  const bad=path.join(outputs,'not-uuid.mp3');fs.copyFileSync(FIXTURE,bad);assert.throws(()=>T.stage({...o,source:bad}));
  const link=path.join(outputs,'11111111-1111-4111-8111-111111111111.mp3');fs.symlinkSync(FIXTURE,link);assert.throws(()=>T.stage({...o,source:link}),/symbolic/);
  const hard=path.join(outside,'hard.mp3');fs.linkSync(wrong,hard);assert.throws(()=>T.stage({...o,source:wrong}),/one link/);
  assert.throws(()=>T.stage({...o,source:outputs}));
  // Prove no directory enumeration and no access to a sentinel gateway file.
  const extra=path.join(outputs,'do-not-open');fs.writeFileSync(extra,'sentinel');
  const original=fs.readdirSync;fs.readdirSync=()=>{throw new Error('directory listing forbidden');};
  try { const result=T.stage({...o,scene:'second'}); assert.equal(result.cid,ID); } finally {fs.readdirSync=original;}
  assert.equal(fs.readFileSync(extra,'utf8'),'sentinel'); assert.equal(fs.existsSync(f.source),false);
});
test('protected paths and tool destinations refuse, canonical aliases screened',t=>{
  const f=fixture(t);
  for(const name of ['memory','.env','.env.local','auth-provider.env']) assert.throws(()=>I.canonical(path.join(f.temp,name,'x')));
  const alias=path.join(f.temp,'tool-alias'); fs.symlinkSync(I.TOOL,alias);
  assert.throws(()=>I.destination(path.join(alias,'new-output.json')),/inside this tool/);
  const escape=path.join(f.production,'narration','escape');fs.symlinkSync(f.temp,escape);
  assert.throws(()=>T.stage({production:f.production,scene:'escape',route:'chatterbox',source:f.source,...I.identity(f.source)}),/escapes/);
  assert.throws(()=>T.stage({production:f.production,scene:'second',route:'chatterbox',source:f.source,cid:ID,...I.identity(f.source)}),/generates/);
});
test('file refuses descriptor, prepared identity, timing and call defects before any record write',t=>{
  const f=fixture(t); fs.unlinkSync(f.record);
  const cases=[['pcm',x=>x.sample_count=true],['pcm',x=>x.sha256='f'.repeat(64)],['pcm',x=>x.removed=1],['pcm',x=>x.usable=false],['pcm',x=>x.source.before.sha256='f'.repeat(64)],['prepared',x=>x.script.sha256='f'.repeat(64)],['prepared',x=>x.correspondence[0].script_token='NEW'],['prepared',x=>x.submitted.code_points=5001],['call',x=>x.action='wrong'],['timings',x=>x[0].text='NEW']];
  for(const [key,change] of cases) {
    const old=I.read(f.o[key]), data=I.json(f.o[key]);change(data);write(f.o[key],data);
    assert.throws(()=>T.file(f.o));assert.equal(fs.existsSync(f.record),false);fs.writeFileSync(f.o[key],old);
  }
});
test('stage retains a gateway source when its new copy fails verification, across devices without rename',t=>{
  const f=fixture(t,'elevenlabs'); fs.copyFileSync(FIXTURE,f.source);
  const copy=fs.copyFileSync, rename=fs.renameSync;
  fs.renameSync=()=>{const e=new Error('cross-device'); e.code='EXDEV';throw e;};
  fs.copyFileSync=(src,dest,flags)=>{copy(src,dest,flags);fs.appendFileSync(dest,'damage');};
  try { assert.throws(()=>T.stage({production:f.production,scene:'failed-copy',route:'elevenlabs',source:f.source,...I.identity(f.source)}),/mismatch/); }
  finally { fs.copyFileSync=copy;fs.renameSync=rename; }
  assert.equal(fs.existsSync(f.source),true);
  const output=path.join(f.production,'narration','failed-copy',ID+'.mp3');
  assert.equal(fs.existsSync(output),true);assert.equal(fs.existsSync(path.join(f.production,'narration','narration.json')),false);
  fs.renameSync=()=>{const e=new Error('cross-device'); e.code='EXDEV';throw e;};
  try { T.stage({production:f.production,scene:'successful-copy',route:'elevenlabs',source:f.source,...I.identity(f.source)}); }
  finally { fs.renameSync=rename; }
  assert.equal(fs.existsSync(f.source),false);
});
test('local stage refuses an existing generated UUID destination',t=>{
  const f=fixture(t), random=I.crypto.randomUUID;I.crypto.randomUUID=()=>f.st.cid;
  try { assert.throws(()=>T.stage({production:f.production,scene:'scene',route:'chatterbox',source:f.source,...I.identity(f.source)}),/already exists/); }
  finally { I.crypto.randomUUID=random; }
});
test('help and stage do not need ffprobe; audio operations fail clearly when it is missing',t=>{
  const f=fixture(t), entry=path.join(__dirname,'../scripts/narration-takes.js'), env={...process.env,PATH:f.temp};
  for(const args of [['help'],['validate','--help']]) {
    const result=spawnSync(process.execPath,[entry,...args],{env,encoding:'utf8'});assert.equal(result.status,0);assert.match(result.stdout,/Narration Takes/);assert.equal(result.stderr,'');
  }
  const result=spawnSync(process.execPath,[entry,'validate','--production',f.production,'--record',f.record],{env,encoding:'utf8'});
  assert.equal(result.status,1);assert.equal(result.stdout,'');assert.match(result.stderr,/missing ffprobe; check: ffprobe -version/);
  const staged=spawnSync(process.execPath,[entry,'stage','--production',f.production,'--scene','--valid-id','--route','chatterbox','--source',f.source,'--bytes',String(I.identity(f.source).bytes),'--sha256',I.identity(f.source).sha256],{env,encoding:'utf8'});
  assert.equal(staged.status,0);assert.equal(JSON.parse(staged.stdout).scene,'--valid-id');
});
test('current revalidates immediately before publication and rereads registry after validation',t=>{
  const f=fixture(t), validate=M.validateRecord;let calls=0;
  M.validateRecord=(...args)=>{
    const result=validate(...args);
    if(++calls===1) mutate(f,r=>r.check.result='fail');
    return result;
  };
  try {assert.throws(()=>T.current(f.current),/became ineligible/);} finally {M.validateRecord=validate;}
  assert.equal(fs.existsSync(f.registry),false);
  mutate(f,r=>r.check.result='pass');calls=0;
  M.validateRecord=(...args)=>{
    const result=validate(...args);
    if(++calls===2)write(f.registry,{settings:I.json(f.current.settings),scenes:{other:{cid:ID}}});
    return result;
  };
  try {assert.throws(()=>T.current(f.current),/changed prior/);} finally {M.validateRecord=validate;}
  assert.equal(I.json(f.registry).scenes.other.cid,ID);assert.equal(I.json(f.registry).scenes.scene,undefined);
});
