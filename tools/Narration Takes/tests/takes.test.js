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
function transcriptText(cid) { return 'TRANSCRIPT\n\nAudio file: '+cid+'.wav\nTranscribed: 2026-10-27 12:00:00\nModel: base\n\nNew board.\n'; }
function fixture(t,route='chatterbox',text='New board.',fileNow=true) {
  const temp=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'narration-takes-test-')));
  t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
  const production=path.join(temp,'production'); fs.mkdirSync(production);
  let source;
  if (route==='elevenlabs') { const outputs=path.join(temp,'gateway','outputs'); fs.mkdirSync(outputs,{recursive:true}); source=path.join(outputs,ID+'.mp3'); fs.copyFileSync(FIXTURE,source); }
  else source=wav(path.join(temp,'source.wav'),24);
  const st=T.stage({production,scene:'scene',route,source,...I.identity(source)});
  const dir=path.dirname(st.source), aligned=path.join(dir,st.cid+'.wav');
  const src=M.sourceClock(st.source);
  if(route==='elevenlabs') decode(st.source,aligned);
  else wav(aligned,16,src.rate,24000,src.channels);
  const samples=M.wav(aligned).duration_ts;
  const a=I.identity(aligned);
  const descriptor={ok:true,usable:true,basis:src.basis,removed:src.removed,stated:src.stated,rate:src.rate,channels:src.channels,codec:'pcm_s16le',time_base:'1/'+src.rate,sample_count:samples,...a,output:aligned,source:{path:st.source,before:st.file,after:st.file}};
  const settings={device:'mps',exaggeration:0.7,cfg_weight:0.3,seed:20261026,seed_step:1,max_words:35,trim_db:-50,mark_gap_s:0.5,sentence_gap_s:0.3,repetition_penalty:1.2,min_p:0.05,top_p:1,temperature:0.8};
  const facts=route==='elevenlabs' ? {voice_id:'voice',model_id:'eleven_v4'} : {reference_sha256:'a'.repeat(64),settings};
  const prep=preparation(text,route), length=samples/src.rate;
  const timings=prep.tokens.map((token,i)=>({text:token,start:i*length/prep.tokens.length,end:(i+1)*length/prep.tokens.length}));
  const transcript=path.join(dir,st.cid+'-transcript-2026-10-27.txt'); fs.writeFileSync(transcript,transcriptText(st.cid));
  const o={production,stage:write(path.join(temp,'stage.json'),st),prepared:write(path.join(temp,'prepared.json'),prep),pcm:write(path.join(temp,'pcm.json'),descriptor),timings:write(path.join(temp,'timings.json'),timings),call:write(path.join(temp,'call.json'),{action:route==='elevenlabs'?'elevenlabs.speech.synthesize':'chatterbox.synthesize',inputs:facts}),check:write(path.join(temp,'check.json'),{result:'pass',transcript:path.basename(transcript)})};
  const record=fileNow ? T.file(o).record : path.join(dir,st.cid+'.json');
  const registry=path.join(production,'narration','narration.json');
  const current={production,record,settings:write(path.join(temp,'settings.json'),{route,language:'en',...facts}),expected:write(path.join(temp,'prior.json'),null)};
  return {temp,production,st,dir,aligned,o,record,registry,current,source,transcript};
}
function mutate(f,fn) { const r=I.json(f.record); fn(r); write(f.record,r); }
function valid(f) { return T.validate({production:f.production,record:f.record,...(!fs.existsSync(f.registry) ? {settings:f.current.settings} : {})}); }

test('help before dependency checks, closed flags and stdout/stderr discipline',()=>{
  for(const args of [['help'],['--help'],['stage','--help'],['current','-h']]) assert.match(run(args),/Narration Takes 0.1.0/);
  for(const args of [[],['bogus'],['help','--install'],['stage','--install'],['stage','--env','/abs/key'],['stage','--wat'],['stage','--source','a','--source','b']]) assert.throws(()=>run(args));
  const result=spawnSync(process.execPath,[path.join(__dirname,'../scripts/narration-takes.js'),'stage','--install'],{encoding:'utf8'});
  assert.equal(result.status,1); assert.equal(result.stdout,''); assert.match(result.stderr,/unknown flag --install/);
  const imported=spawnSync(process.execPath,['-e','require('+JSON.stringify(path.join(__dirname,'../scripts/narration-takes.js'))+')'],{encoding:'utf8'});
  assert.equal(imported.status,0);assert.equal(imported.stdout,'');assert.equal(imported.stderr,'');
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
  next.check.transcript=newId+'-transcript-2026-10-27.txt';fs.copyFileSync(f.transcript,path.join(f.dir,next.check.transcript));
  fs.copyFileSync(f.st.source,path.join(f.dir,newId+'.source.wav'));
  fs.copyFileSync(f.aligned,path.join(f.dir,newId+'.wav'));
  f.record=write(path.join(f.dir,newId+'.json'),next);f.current.record=f.record;
  const oldBytes=I.read(oldRecord);
  for(const state of ['fail','absent']) {
    mutate(f,r=>{ if(state==='fail') r.check.result='fail'; else delete r.check; });
    const result=validEvidence(f); assert.equal(result.valid,true); assert.equal(result.eligible,false);
    assert.throws(()=>T.current(f.current),/ineligible/);
    assert.deepEqual(I.read(f.registry),prior); assert.equal(fs.existsSync(f.transcript),true);
    assert.deepEqual(I.read(oldRecord),oldBytes);
  }
});
// Read evidence without a current registry settings comparison.
function validEvidence(f) { return M.validateRecord(f.production,f.record,I.json(f.current.settings)); }
test('completion adds only caller check without synthesis and refuses changed evidence or prior bytes',t=>{
  const f=fixture(t); mutate(f,r=>delete r.check);
  const prior=I.read(f.record); const expected=path.join(f.temp,'old-take.json'); fs.writeFileSync(expected,prior);
  const before=I.json(f.record).date_filed;
  assert.equal(T.file({...f.o,expected}).valid,true); assert.equal(I.json(f.record).date_filed,before);
  assert.throws(()=>T.file({...f.o,expected}),/expected prior/);
  assert.throws(()=>T.file(f.o),/already exists/);
  assert.throws(()=>T.file({...f.o,expected:f.record}),/separate prior snapshot/);
  fs.writeFileSync(expected,I.read(f.record)); write(f.o.check,{result:'fail',transcript:path.basename(f.transcript)});
  assert.throws(()=>T.file({...f.o,expected}),/change existing/);
});
test('header-only transcript files as fail, never pass or current, preserving the prior pointer',t=>{
  for(const route of ['chatterbox','elevenlabs']) {
    const f=fixture(t,route); T.current(f.current);
    const prior=I.read(f.registry), transcript=transcriptText(f.st.cid).replace('New board.\n','');
    fs.writeFileSync(f.current.expected,prior);
    mutate(f,r=>delete r.check);
    const expected=path.join(f.temp,'unchecked-take.json'); fs.writeFileSync(expected,I.read(f.record));
    for(const text of [transcript,transcript.replace(/\n/g,'\r\n')+' \t\r\n']) {
      fs.writeFileSync(f.transcript,text);
      assert.throws(()=>T.file({...f.o,expected}),/speech body/);
      assert.deepEqual(I.read(f.record),I.read(expected));
    }
    write(f.o.check,{result:'fail',transcript:path.basename(f.transcript)});
    const result=T.file({...f.o,expected});
    assert.equal(result.valid,true); assert.equal(result.eligible,false);
    assert.deepEqual(result.reasons,['check failed']);
    assert.equal(T.validate({...f.current}).eligible,false);
    assert.throws(()=>T.current(f.current),/ineligible.*check failed/);
    assert.deepEqual(I.read(f.registry),prior);
    assert.equal(fs.readFileSync(f.transcript,'utf8'),transcript.replace(/\n/g,'\r\n')+' \t\r\n');
    fs.writeFileSync(f.transcript,transcript);
    assert.equal(T.validate({...f.current}).valid,true);
    assert.equal(T.validate({...f.current}).eligible,false);
    fs.writeFileSync(f.transcript,'not a Transcribe Audio header\n');
    assert.throws(()=>T.validate({...f.current}),/transcript.*header|transcript.*format/);
    fs.writeFileSync(f.transcript,'');
    assert.throws(()=>T.validate({...f.current}),/transcript.*nonempty/);
  }
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
  'transcript digest key':r=>r.check.sha256='f'.repeat(64),
  'aligned source digest key':r=>r.aligned_file.source_sha256=r.file.sha256,
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
  const f=fixture(t), transcript=f.transcript;
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
  fs.unlinkSync(f.aligned);decode(f.st.source,f.aligned,1105);const a=M.wav(f.aligned);
  mutate(f,r=>{r.file=I.identity(f.st.source);Object.assign(r.aligned_file,I.identity(f.aligned),{sample_count:a.duration_ts});r.duration=a.duration_ts/a.rate;r.delay={samples_removed:1105,sample_rate:44100,basis:'lame_no_header',stated_skip_samples:null};});
  assert.equal(valid(f).eligible,true);
  mutate(f,r=>r.delay.samples_removed=1203);assert.throws(()=>valid(f),/delay differs/);
});
test('legacy xAI record and registry validate without rewriting their bytes',t=>{
  const f=fixture(t,'elevenlabs');
  mutate(f,r=>{delete r.route;r.action='xai.speech.synthesize';r.inputs={voice_id:'old-voice',language:'en',timings:'words',text_normalization:false};r.characters=[...r.text].length;r.duration=0.35;});
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
test('a current take filed under earlier settings is reported, not refused, so an interrupted re-voice resumes',t=>{
  // A re-voice rewrites the registry's settings with its first new take while other scenes still point at older ones.
  const f=fixture(t); T.current(f.current);
  const reg=I.json(f.registry); reg.settings={...reg.settings,reference_sha256:'b'.repeat(64)}; write(f.registry,reg);
  const own=T.validate({production:f.production,record:f.record,settings:f.current.settings});
  assert.equal(own.valid,true); assert.equal(own.registry_settings_match,false);
  const bare=T.validate({production:f.production,record:f.record});
  assert.equal(bare.valid,true); assert.equal(bare.registry_settings_match,false);
  // A take current under the registry's own settings still reads as matching.
  const g=fixture(t); T.current(g.current);
  assert.equal(T.validate({production:g.production,record:g.record}).registry_settings_match,true);
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
  // Trap reads, rather than relying on unchanged sentinel bytes. Positive
  // controls prove the traps catch each accidental extra-file read.
  const extra=path.join(outputs,'do-not-open');fs.writeFileSync(extra,'sentinel');
  const originals=new Map();
  const guard=(api,listing=false)=>{
    const original=fs[api];originals.set(api,original);
    fs[api]=function(file,...args){
      const resolved=typeof file==='string' ? path.resolve(file) : null;
      const rel=resolved===null ? '..' : path.relative(outputs,resolved);
      const inGateway=rel==='' || (rel!=='..' && !rel.startsWith('..'+path.sep) && !path.isAbsolute(rel));
      const metadata=['statSync','lstatSync','accessSync','existsSync','readlinkSync'].includes(api);
      if(inGateway && (listing || (resolved!==f.source && !(metadata && resolved===outputs)))) throw new Error('forbidden gateway read: '+api);
      return original.call(fs,file,...args);
    };
  };
  for(const api of ['openSync','readFileSync','createReadStream','copyFileSync','open','readFile','copyFile','statSync','lstatSync','accessSync','existsSync','readlinkSync'])guard(api);
  for(const api of ['readdirSync','opendirSync','readdir','opendir'])guard(api,true);
  try {
    assert.throws(()=>fs.openSync(extra,'r'),/forbidden gateway read/);
    assert.throws(()=>fs.openSync(outputs,'r'),/forbidden gateway read/);
    assert.throws(()=>fs.readFileSync(extra),/forbidden gateway read/);
    assert.throws(()=>fs.createReadStream(extra),/forbidden gateway read/);
    assert.throws(()=>fs.copyFileSync(extra,path.join(f.temp,'forbidden-copy')),/forbidden gateway read/);
    assert.throws(()=>fs.readdirSync(outputs),/forbidden gateway read/);
    assert.throws(()=>fs.statSync(extra),/forbidden gateway read/);
    const result=T.stage({...o,scene:'second'});assert.equal(result.cid,ID);
  } finally {for(const [api,original] of originals)fs[api]=original;}
  assert.equal(fs.readFileSync(extra,'utf8'),'sentinel');assert.equal(fs.existsSync(f.source),false);
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
  const cases=[['pcm',x=>x.sample_count=true],['pcm',x=>x.sha256='f'.repeat(64)],['pcm',x=>x.removed=1],['pcm',x=>x.source.before.sha256='f'.repeat(64)],['prepared',x=>x.script.sha256='f'.repeat(64)],['prepared',x=>x.correspondence[0].script_token='NEW'],['prepared',x=>x.submitted.code_points=5001],['call',x=>x.action='wrong'],['timings',x=>x[0].text='NEW']];
  for(const [key,change] of cases) {
    const old=I.read(f.o[key]), data=I.json(f.o[key]);change(data);write(f.o[key],data);
    assert.throws(()=>T.file(f.o));assert.equal(fs.existsSync(f.record),false);fs.writeFileSync(f.o[key],old);
  }
});
test('R8 copy path covers distinct devices, copy errors and verification before source removal',t=>{
  const f=fixture(t,'elevenlabs');fs.copyFileSync(FIXTURE,f.source);
  const copy=fs.copyFileSync, stat=fs.statSync, lstat=fs.lstatSync;let copies=0;
  // The OS fixture is one volume. Present distinct source/destination device
  // identities to the screen, and assert the exact copy API/flags used.
  const deviceStat=original=>function(file,...args){
    const value=original.call(fs,file,...args);
    if(file===f.source)value.dev=typeof value.dev==='bigint' ? 9001n : 9001;
    return value;
  };
  fs.statSync=deviceStat(stat);fs.lstatSync=deviceStat(lstat);
  const ident=I.identity(f.source), options={production:f.production,route:'elevenlabs',source:f.source,...ident};
  try {
    fs.copyFileSync=(src,dest,flags)=>{
      copies++;assert.equal(src,f.source);assert.equal(flags,fs.constants.COPYFILE_EXCL);
      assert.notEqual(fs.statSync(src).dev,fs.statSync(f.production).dev);
      const error=new Error('injected copy EXDEV');error.code='EXDEV';throw error;
    };
    assert.throws(()=>T.stage({...options,scene:'copy-error'}),/injected copy EXDEV/);
    assert.equal(fs.existsSync(f.source),true);
    fs.copyFileSync=(src,dest,flags)=>{copies++;copy(src,dest,flags);fs.appendFileSync(dest,'damage');};
    assert.throws(()=>T.stage({...options,scene:'failed-copy'}),/mismatch/);
    assert.equal(fs.existsSync(f.source),true);
    fs.copyFileSync=(src,dest,flags)=>{copies++;assert.equal(flags,fs.constants.COPYFILE_EXCL);copy(src,dest,flags);};
    const staged=T.stage({...options,scene:'successful-copy'});
    assert.deepEqual(I.identity(staged.source),ident);assert.equal(fs.existsSync(f.source),false);assert.equal(copies,3);
  } finally {fs.copyFileSync=copy;fs.statSync=stat;fs.lstatSync=lstat;}
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


// Round-one repairs: each regression is run against the reviewed implementation
// before its repair. Helpers here manufacture evidence, never synthesis.
function clearRecord(f) { fs.unlinkSync(f.record); }
function nullAudio(pcm) {
  pcm.usable=false;
  for(const key of ['codec','time_base','sample_count','bytes','sha256','output']) pcm[key]=null;
  return pcm;
}
function decode(source,output,removed=0) {
  const args=['-n','-v','error','-i',source,'-map_metadata','-1','-fflags','+bitexact','-flags:a','+bitexact','-c:a','pcm_s16le'];
  if(removed) args.push('-af','atrim=start_sample='+removed);
  const r=spawnSync('ffmpeg',[...args,output],{encoding:'utf8'});
  assert.equal(r.status,0,r.stderr); assert.equal(r.stderr,'');
}
function refreshAudio(f) {
  const pcm=I.json(f.o.pcm), a=M.wav(f.aligned);
  Object.assign(pcm,{sample_count:a.duration_ts,...I.identity(f.aligned)}); write(f.o.pcm,pcm);
  return pcm;
}
test('R1 unknown or unusable delay files resumable evidence with no new source',t=>{
  for(const unknown of [false,true]) {
    const f=fixture(t,'elevenlabs','New board.',false), original=I.read(f.st.source), usable=I.json(f.o.pcm);
    const pcm=nullAudio(I.json(f.o.pcm));
    if(unknown) Object.assign(pcm,{basis:'unknown',removed:0,stated:null});
    write(f.o.pcm,pcm);
    assert.equal(T.file(f.o).eligible,false);
    const r=I.json(f.record); assert.equal(r.aligned_file,null); assert.equal(r.delay.basis,pcm.basis);
    assert.equal(validEvidence(f).valid,true); assert.deepEqual(I.read(f.st.source),original);
    assert.throws(()=>T.current(f.current),/ineligible/);
    const expected=write(path.join(f.temp,'unfinished.json'),r);
    write(f.o.pcm,usable);
    assert.equal(T.file({...f.o,expected}).valid,true);
    assert.equal(T.validate({...f.current}).eligible,true);
    assert.deepEqual(I.read(f.st.source),original);
  }
});
test('R2 descriptors bind source and WAV identities and reject the short MP3 stand-in',t=>{
  const f=fixture(t,'elevenlabs'); clearRecord(f);
  const original=I.read(f.o.pcm);
  const pcm=I.json(f.o.pcm); pcm.bytes++; write(f.o.pcm,pcm);
  // A record whose WAV hash/bytes match disk cannot excuse a bad descriptor.
  assert.throws(()=>T.file(f.o),/descriptor|identity|mismatch/);
  fs.writeFileSync(f.o.pcm,original);
  for(const fields of [['before'],['after'],['before','after']]) {
    const descriptor=I.json(f.o.pcm);
    for(const field of fields) descriptor.source[field].sha256='f'.repeat(64);
    write(f.o.pcm,descriptor);
    assert.throws(()=>T.file(f.o),/PCM source identity/);
    assert.equal(fs.existsSync(f.record),false);
    fs.writeFileSync(f.o.pcm,original);
  }
  wav(f.aligned,16,44100,4410); refreshAudio(f);
  assert.throws(()=>T.file(f.o),/sample count|decoded|source clock/);
  fs.unlinkSync(f.aligned); decode(f.st.source,f.aligned); refreshAudio(f);
  const timings=I.json(f.o.timings);timings.forEach((x,i)=>{x.start=i*0.1;x.end=(i+1)*0.1;});write(f.o.timings,timings);
  T.file(f.o);
  const aligned=I.json(f.record).aligned_file;
  assert.equal(Object.hasOwn(aligned,'source_sha256'),false);
  assert.deepEqual(Object.keys(aligned).sort(),['bytes','name','sample_count','sha256']);
  assert.equal(validEvidence(f).eligible,true);
  const source=I.read(f.st.source);
  fs.appendFileSync(f.st.source,'changed');
  assert.throws(()=>validEvidence(f),/file bytes or sha256 mismatch/);
  fs.writeFileSync(f.st.source,source);
  assert.equal(validEvidence(f).eligible,true);
  // A self-consistent forged WAV/record still has to match the decoded source.
  wav(f.aligned,16,44100,4410);
  mutate(f,r=>{Object.assign(r.aligned_file,I.identity(f.aligned),{sample_count:4410});r.duration=0.1;r.timings.forEach(x=>{x.start=0;x.end=0.05;});});
  assert.throws(()=>validEvidence(f),/sample count|decoded|source clock/);
});
test('R3 exact JSON timing lexemes agree with Scene Composer clocks',t=>{
  const f=fixture(t), before=I.read(f.record).toString();
  fs.writeFileSync(f.record,before.replace('"end": 1','"end": 1.0000000000000001'));
  assert.throws(()=>validEvidence(f),/past|length|clock/);
  fs.writeFileSync(f.record,before.replace('"start": 0','"start": -1e-400'));
  assert.throws(()=>validEvidence(f),/negative|start|past|length|clock/);
  // 1/5 = 0.2 is exact decimal but not dyadic. Its Number division agrees with
  // Scene Composer, even where rounded multiplication/duration checks do not.
  wav(f.aligned,16,24000,4800); wav(f.st.source,24,24000,4800);
  const r=I.parse(before);r.file=I.identity(f.st.source);Object.assign(r.aligned_file,I.identity(f.aligned),{sample_count:4800});
  r.duration=0.2;r.timings=[{text:'New',start:0,end:0.1},{text:'board.',start:0.1,end:0.2}];
  write(f.record,r);assert.equal(validEvidence(f).valid,true);
  const SC=require('../../Scene Composer/scripts/rational.js');
  assert.equal(SC.parse(I.read(f.record).toString()).timings[1].end.cmp(new SC.Q(4800n,24000n)),0);
  // Filing must retain lexemes rather than round an overflow down to 1.
  const g=fixture(t);clearRecord(g);
  fs.writeFileSync(g.o.timings,I.read(g.o.timings).toString().replace('"end": 1','"end": 1.0000000000000001'));
  assert.throws(()=>T.file(g.o),/past|length|clock/);
});
test('R5 passing checks bind cid, transcript name and English settings without a stored digest',t=>{
  const f=fixture(t);
  const check=I.json(f.record).check;
  assert.equal(Object.hasOwn(check,'sha256'),false);
  assert.deepEqual(Object.keys(check).sort(),['result','transcript']);
  assert.equal(check.transcript,f.st.cid+'-transcript-2026-10-27.txt');
  for(const name of ['notes.txt',ID+'-transcript-2026-10-27.txt']) {
    fs.writeFileSync(path.join(f.dir,name),'a renamed note');
    mutate(f,r=>r.check={result:'pass',transcript:name});
    assert.throws(()=>validEvidence(f),/transcript.*cid|transcript.*name/);
  }
  mutate(f,r=>r.check=check);
  const record=I.read(f.record);
  fs.writeFileSync(f.transcript,transcriptText(f.st.cid).replace('12:00:00','13:00:00').replace('New board.','New board. A replacement transcript.'));
  assert.equal(validEvidence(f).eligible,true);
  assert.deepEqual(I.read(f.record),record);
  clearRecord(f);
  fs.writeFileSync(f.transcript,'a renamed note');
  assert.throws(()=>T.file(f.o),/transcript.*format|transcript.*header/);
  fs.writeFileSync(f.transcript,transcriptText(f.st.cid));T.file(f.o);
  assert.equal(T.validate({production:f.production,record:f.record}).eligible,false);
  const settings=I.json(f.current.settings);
  for(const language of ['fr','FR-ca','english']) {
    write(f.current.settings,{...settings,language});
    assert.equal(T.validate({...f.current}).eligible,false);assert.throws(()=>T.current(f.current),/ineligible/);
  }
  for(const language of ['en','eng','EN-us','EnG-US']) {
    write(f.current.settings,{...settings,language});assert.equal(T.validate({...f.current}).eligible,true);
  }
});
test('R6 write, fsync and close failures leave no blocking record or temporary and retry succeeds',t=>{
  for(const operation of ['writeFileSync','fsyncSync','closeSync']) {
    const f=fixture(t);clearRecord(f);const original=fs[operation];let fired=false;
    // Only a descriptor opened for a new file ('wx'), the write path, is failed; reads close their own descriptors.
    const open=fs.openSync, written=new Set();
    fs.openSync=function(file,flags,...rest){const fd=open.call(fs,file,flags,...rest);if(flags==='wx')written.add(fd);return fd;};
    fs[operation]=function(fd,...args) {
      if(typeof fd==='number' && written.has(fd) && !fired) {
        fired=true;
        if(operation==='writeFileSync') original.call(fs,fd,Buffer.from('{'));
        // A close that fails after a successful fsync: the descriptor is released, then the call reports failure.
        if(operation==='closeSync') original.call(fs,fd,...args);
        throw new Error('injected '+operation);
      }
      return original.call(fs,fd,...args);
    };
    try {assert.throws(()=>T.file(f.o),/injected/);} finally {fs[operation]=original;fs.openSync=open;}
    assert.equal(fired,true);assert.equal(fs.existsSync(f.record),false);
    assert.equal(fs.readdirSync(f.dir).some(x=>x.startsWith('.narration-takes-')),false);
    assert.equal(T.file(f.o).valid,true);
  }
  // The same cleanup applies to completion/registry siblings.
  const f=fixture(t);mutate(f,r=>delete r.check);
  const expected=write(path.join(f.temp,'expected.json'),I.json(f.record)), before=I.read(f.record), sync=fs.fsyncSync;
  fs.fsyncSync=()=>{throw new Error('injected fsync');};
  try {assert.throws(()=>T.file({...f.o,expected}),/injected/);} finally {fs.fsyncSync=sync;}
  assert.deepEqual(I.read(f.record),before);assert.equal(fs.readdirSync(f.dir).some(x=>x.startsWith('.narration-takes-')),false);
  assert.equal(T.file({...f.o,expected}).valid,true);
});
test('R7 gateway unlink is the final source or copy verification operation',t=>{
  const f=fixture(t,'elevenlabs');fs.copyFileSync(FIXTURE,f.source);
  const ident=I.identity(f.source), read=fs.readFileSync, unlink=fs.unlinkSync;let removed=false;
  fs.unlinkSync=function(file,...args){const result=unlink.call(fs,file,...args);if(file===f.source)removed=true;return result;};
  fs.readFileSync=function(file,...args){if(removed)throw new Error('hash/read after unlink');return read.call(fs,file,...args);};
  try {T.stage({production:f.production,scene:'last-unlink',route:'elevenlabs',source:f.source,...ident});}
  finally {fs.unlinkSync=unlink;fs.readFileSync=read;}
  assert.equal(removed,true);
});
test('R8 canonical screen checks filesystem identities and later opens only its returned path',t=>{
  const f=fixture(t), alias=path.join(f.temp,'alias');fs.symlinkSync(f.production,alias);
  const stat=fs.statSync;let comparisons=0;
  fs.statSync=function(file,...args){comparisons++;return stat.call(fs,file,...args);};
  try {assert.equal(I.canonical(alias),f.production);assert.ok(comparisons>=2,'compare device/inode before and after realpath');}
  finally {fs.statSync=stat;}
  let calls=0;
  fs.statSync=function(file,...args){const result=stat.call(fs,file,...args);if(++calls===2)result.ino++;return result;};
  try {assert.throws(()=>I.canonical(alias),/identity changed/);} finally {fs.statSync=stat;}
  const canonical=I.canonical;let screened;
  I.canonical=function(file){const result=canonical(file);if(file===alias)screened=result;return result;};
  const stage=T.stage;T.stage=o=>{assert.equal(o.production,screened);return {ok:true};};
  try {run(['stage','--production',alias,'--scene','scene','--route','chatterbox','--source',f.source,'--bytes','1','--sha256','a'.repeat(64)]);}
  finally {I.canonical=canonical;T.stage=stage;}
});
