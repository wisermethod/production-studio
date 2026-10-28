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
const ID = '00000000-0000-4000-8000-000000000001';
const OTHER = '00000000-0000-4000-8000-000000000002';
function write(file,value) { fs.writeFileSync(file,I.encode(value)); return file; }
function wav(file,bits=16,rate=44100,samples=44100,channels=1) {
  const bytes=samples*channels*bits/8, b=Buffer.alloc(44+bytes);
  b.write('RIFF'); b.writeUInt32LE(36+bytes,4); b.write('WAVEfmt ',8); b.writeUInt32LE(16,16);
  b.writeUInt16LE(1,20); b.writeUInt16LE(channels,22); b.writeUInt32LE(rate,24);
  b.writeUInt32LE(rate*channels*bits/8,28); b.writeUInt16LE(channels*bits/8,32); b.writeUInt16LE(bits,34);
  b.write('data',36); b.writeUInt32LE(bytes,40); fs.writeFileSync(file,b); return file;
}
function cli(command,options) { return run([command,...Object.entries(options).flatMap(([k,v])=>['--'+k,String(v)])]); }
function gateway(t) {
  const temp=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'narration-takes-test-')));
  t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
  const production=path.join(temp,'production'), home=path.join(temp,'gateway'), outputs=path.join(home,'outputs');
  fs.mkdirSync(production); fs.mkdirSync(outputs,{recursive:true});
  const source=wav(path.join(outputs,ID+'.wav'));
  const options={production,scene:'scene',route:'heygen',source,...I.identity(source),cid:ID};
  return {temp,production,home,outputs,source,options};
}
// Invented Speech Preparation text/character-timings/PCM evidence. No vendor
// call, primitive invocation or import outside this tool supplies these fixtures.
function fixture(t,withLanguage=true) {
  const g=gateway(t), st=cli('stage',g.options), dir=path.dirname(st.source);
  const text='New <emphasis>board.</emphasis> [pause] Again.', submitted='New board. Again.';
  const form=text=>({text,code_points:[...text].length,sha256:I.hash(Buffer.from(text))});
  const tokens=['New','board.','Again.'];
  const correspondence=[[0,3,3],[4,10,9],[11,17,16]].map(([start,end,spokenEnd],i)=>({
    script_index:i,script_token:tokens[i],route_word:tokens[i],route_start:start,route_end:end,spoken_start:start,spoken_end:spokenEnd
  }));
  const prepared={version:1,route:'heygen',script:form(text),submitted:form(submitted),tokens,words:tokens,correspondence};
  const alignment={original_characters:[...submitted].map((text,i)=>({text,start_time:i/25,end_time:(i+1)/25}))};
  const timings=correspondence.map(c=>({text:c.script_token,start:alignment.original_characters[c.spoken_start].start_time,end:alignment.original_characters[c.spoken_end-1].end_time}));
  const aligned=path.join(dir,ID+'.wav'); fs.copyFileSync(st.source,aligned);
  const pcm={ok:true,usable:true,basis:'pcm',removed:0,stated:null,rate:44100,channels:1,codec:'pcm_s16le',time_base:'1/44100',sample_count:44100,
    ...I.identity(aligned),output:aligned,source:{path:st.source,before:st.file,after:st.file}};
  const facts={voice_id:'invented_voice-1',model:'heygen-voice-1-turbo-free',expressiveness_boost:0.5,...(withLanguage?{language:'en-US'}:{})};
  const transcript=path.join(dir,ID+'-transcript-2026-10-28.txt');
  fs.writeFileSync(transcript,'TRANSCRIPT\n\nAudio file: '+ID+'.wav\nTranscribed: 2026-10-28 12:00:00\nModel: base\n\nNew board. Again.\n');
  const o={production:g.production,stage:write(path.join(g.temp,'stage.json'),st),prepared:write(path.join(g.temp,'prepared.json'),prepared),
    pcm:write(path.join(g.temp,'pcm.json'),pcm),timings:write(path.join(g.temp,'timings.json'),timings),
    call:write(path.join(g.temp,'call.json'),{action:'heygen.speech.synthesize',inputs:facts}),
    check:write(path.join(g.temp,'check.json'),{result:'pass',transcript:path.basename(transcript)})};
  const {language,...settingsFacts}=facts;
  const record=path.join(dir,ID+'.json'), registry=path.join(g.production,'narration','narration.json');
  const current={production:g.production,record,settings:write(path.join(g.temp,'settings.json'),{route:'heygen',language:language||'en',...settingsFacts}),expected:write(path.join(g.temp,'prior.json'),null)};
  return {...g,st,dir,aligned,prepared,timings,o,record,registry,current};
}

test('HeyGen stage preserves the gateway UUID, verifies the WAV and needs no ffprobe',t=>{
  const f=gateway(t), entry=path.join(__dirname,'../scripts/narration-takes.js');
  assert.match(run(['stage','--help']),/heygen/);
  const result=spawnSync(process.execPath,[entry,'stage',...Object.entries(f.options).flatMap(([k,v])=>['--'+k,String(v)])],{encoding:'utf8',env:{...process.env,PATH:f.temp}});
  assert.equal(result.status,0,result.stderr); assert.equal(result.stderr,'');
  const staged=JSON.parse(result.stdout);
  assert.deepEqual(staged,{ok:true,route:'heygen',scene:'scene',cid:ID,source:path.join(f.production,'narration','scene',ID+'.source.wav'),file:{bytes:f.options.bytes,sha256:f.options.sha256}});
  assert.deepEqual(I.identity(staged.source),staged.file); assert.equal(fs.existsSync(f.source),false);
  wav(f.source); const {cid,...noCid}=f.options;
  assert.equal(cli('stage',{...noCid,scene:'without-cid'}).cid,ID);
});
const STAGE_DEFECTS = {
  'a symbolic link':f=>{const target=path.join(f.temp,'real.wav');fs.renameSync(f.source,target);fs.symlinkSync(target,f.source);},
  'a wrong extension':f=>{const source=f.source.replace('.wav','.mp3');fs.renameSync(f.source,source);f.options.source=source;},
  'a file outside outputs':f=>{const source=path.join(f.home,ID+'.wav');fs.renameSync(f.source,source);f.options.source=source;},
  'a nested outputs file':f=>{const nested=path.join(f.outputs,'nested');fs.mkdirSync(nested);const source=path.join(nested,ID+'.wav');fs.renameSync(f.source,source);f.options.source=source;},
  'a UUID mismatch':f=>{f.options.cid=OTHER;},
  'a non-UUID filename':f=>{const source=path.join(f.outputs,'not-a-uuid.wav');fs.renameSync(f.source,source);f.options.source=source;},
  'a production inside the gateway home':f=>{f.options.production=f.home;},
  'a production alias into the gateway home':f=>{const alias=path.join(f.temp,'alias');fs.symlinkSync(f.home,alias);f.options.production=alias;},
  'a hard link':f=>{fs.linkSync(f.source,path.join(f.temp,'hard.wav'));},
  'a nonregular file':f=>{fs.unlinkSync(f.source);fs.mkdirSync(f.source);},
  'incorrect bytes':f=>{f.options.bytes++;},
  'an incorrect SHA-256':f=>{f.options.sha256='f'.repeat(64);}
};
for(const [name,defect] of Object.entries(STAGE_DEFECTS)) test('HeyGen stage refuses '+name,t=>{
  const f=gateway(t); defect(f);
  assert.throws(()=>cli('stage',f.options));
  assert.equal(fs.existsSync(f.options.source),true);
  assert.equal(fs.existsSync(path.join(f.production,'narration')),false);
});
test('HeyGen gateway transfer is exclusive and removal follows all source/copy verification',t=>{
  const f=gateway(t), identity=I.identity, copy=fs.copyFileSync, unlink=fs.unlinkSync, listing=fs.readdirSync;
  const calls=[]; let copied,removed=false;
  I.identity=file=>{assert.equal(removed,false);calls.push(file);return identity(file);};
  fs.copyFileSync=(source,destination,flags)=>{assert.equal(flags,fs.constants.COPYFILE_EXCL);copied=destination;return copy(source,destination,flags);};
  fs.readdirSync=()=>{throw new Error('gateway listing is forbidden');};
  fs.unlinkSync=file=>{assert.equal(file,f.source);assert.deepEqual(calls,[f.source,copied,f.source]);unlink(file);removed=true;};
  try {cli('stage',f.options);} finally {I.identity=identity;fs.copyFileSync=copy;fs.unlinkSync=unlink;fs.readdirSync=listing;}
  assert.equal(removed,true); assert.deepEqual(identity(copied),{bytes:f.options.bytes,sha256:f.options.sha256});
  wav(f.source); const before=I.read(copied);
  assert.throws(()=>cli('stage',f.options),/already exists/);
  assert.deepEqual(I.read(copied),before); assert.equal(fs.existsSync(f.source),true);
  fs.copyFileSync=(source,destination,flags)=>{copy(source,destination,flags);fs.appendFileSync(destination,'damage');};
  try {assert.throws(()=>cli('stage',{...f.options,scene:'damaged-copy'}),/mismatch/);} finally {fs.copyFileSync=copy;}
  assert.equal(fs.existsSync(f.source),true);
});
test('HeyGen files prepared PCM and original word timings, validates and becomes current',t=>{
  for(const withLanguage of [true,false]) {
    const f=fixture(t,withLanguage), staged=I.read(f.st.source);
    assert.equal(cli('file',f.o).valid,true);
    const r=JSON.parse(I.utf8(I.read(f.record)));
    assert.deepEqual(Object.keys(r).sort(),['scene','cid','route','action','inputs','text','text_sha256','characters','duration','file','date_filed','timings','delay','aligned_file','check'].sort());
    assert.equal(r.route,'heygen'); assert.equal(r.action,'heygen.speech.synthesize');
    assert.equal(r.text,f.prepared.script.text); assert.equal(r.text_sha256,f.prepared.script.sha256);
    assert.equal(r.characters,f.prepared.submitted.code_points); assert.equal(r.duration,1);
    assert.deepEqual(r.timings,f.timings); assert.equal(I.equal(r.inputs,I.json(f.o.call).inputs),true);
    assert.deepEqual(r.delay,{samples_removed:0,sample_rate:44100,basis:'pcm',stated_skip_samples:null});
    assert.deepEqual(r.aligned_file,{name:ID+'.wav',...I.identity(f.aligned),sample_count:44100});
    assert.equal(cli('validate',{production:f.production,record:f.record,settings:f.current.settings}).eligible,true);
    assert.deepEqual(cli('current',f.current).current,{scene:'scene',cid:ID});
    assert.deepEqual(I.json(f.registry).settings,I.json(f.current.settings));
    assert.equal(cli('validate',{production:f.production,record:f.record}).registry_settings_match,true);
    assert.deepEqual(I.read(f.st.source),staged);
  }
});
test('HeyGen filing refuses a wrong call, vendor envelope, prepared route or delay basis before writing',t=>{
  const f=fixture(t);
  const defects=[['call',x=>x.action='elevenlabs.speech.synthesize'],['call',x=>x.data={}],['call',x=>x.inputs.text='New board. Again.'],
    ['prepared',x=>x.route='elevenlabs'],['pcm',x=>x.basis='header_skip_samples'],['pcm',x=>x.removed=1105],
    ['pcm',x=>{x.basis='unknown';x.usable=false;for(const key of ['codec','time_base','sample_count','bytes','sha256','output'])x[key]=null;}]];
  for(const [key,defect] of defects) {
    const before=I.read(f.o[key]), value=I.json(f.o[key]); defect(value); write(f.o[key],value);
    assert.throws(()=>cli('file',f.o)); assert.equal(fs.existsSync(f.record),false); fs.writeFileSync(f.o[key],before);
  }
  assert.equal(cli('file',f.o).valid,true);
});
test('HeyGen validate and current refuse extra keys, wrong action and wrong basis without changing the pointer',t=>{
  const f=fixture(t); cli('file',f.o); cli('current',f.current);
  const record=I.read(f.record), registry=I.read(f.registry); fs.writeFileSync(f.current.expected,registry);
  for(const defect of [r=>r.extra=true,r=>r.inputs.extra=true,r=>r.action='chatterbox.synthesize',r=>r.delay.basis='lame_no_header',
    r=>{r.delay.basis='unknown';r.aligned_file=null;},r=>r.delay.samples_removed=1]) {
    const r=I.parse(I.utf8(record)); defect(r); write(f.record,r);
    assert.throws(()=>cli('validate',{production:f.production,record:f.record,settings:f.current.settings}));
    assert.throws(()=>cli('current',f.current)); assert.deepEqual(I.read(f.registry),registry);
  }
  fs.writeFileSync(f.record,record);
});
test('HeyGen settings compare all route facts and keep language at settings.language',t=>{
  const f=fixture(t); cli('file',f.o); cli('current',f.current);
  const settings=I.read(f.current.settings), registry=I.read(f.registry); fs.writeFileSync(f.current.expected,registry);
  for(const defect of [s=>s.extra=true,s=>s.voice_id='another_voice',s=>s.model='heygen-voice-1',s=>s.expressiveness_boost=0,
    s=>s.language='fr',s=>{s.inputs={language:s.language};delete s.language;},s=>s.route='elevenlabs']) {
    const s=I.parse(I.utf8(settings)); defect(s); write(f.current.settings,s);
    assert.throws(()=>cli('validate',{production:f.production,record:f.record,settings:f.current.settings}));
    assert.throws(()=>cli('current',f.current)); assert.deepEqual(I.read(f.registry),registry);
  }
});
test('HeyGen input facts use the connector enums, ranges and optional language shape',()=>{
  const facts={voice_id:'voice_1',model:'heygen-voice-1',expressiveness_boost:0};
  for(const model of ['heygen-voice-1','heygen-voice-1-turbo','heygen-voice-1-turbo-free'])
    for(const boost of [0,0.5,1]) assert.doesNotThrow(()=>M.inputs({...facts,model,expressiveness_boost:boost,language:'eng-US'},'heygen'));
  assert.doesNotThrow(()=>M.inputs(facts,'heygen'));
  for(const defect of [x=>delete x.expressiveness_boost,x=>x.expressiveness_boost=true,x=>x.expressiveness_boost=-0.1,x=>x.expressiveness_boost=1.1,
    x=>x.expressiveness_boost=Infinity,x=>x.model='eleven_v4',x=>x.voice_id='../voice',x=>x.language='english',x=>x.language='en-'+ 'a'.repeat(30),x=>x.language=null,x=>x.output_format='wav']) {
    const x={...facts};defect(x);assert.throws(()=>M.inputs(x,'heygen'));
  }
});
test('HeyGen source format and aligned sample counts are measured independently',t=>{
  const f=fixture(t);cli('file',f.o);const before=I.read(f.record), source=I.read(f.st.source);
  for(const format of [[24,44100,44100,1],[16,24000,24000,1],[16,44100,44100,2]]) {
    wav(f.st.source,...format);const r=I.parse(I.utf8(before));r.file=I.identity(f.st.source);write(f.record,r);
    assert.throws(()=>cli('validate',{production:f.production,record:f.record}),/HeyGen source must retain/);
  }
  fs.writeFileSync(f.st.source,source);
  wav(f.aligned,16,44100,44099);
  const r=I.parse(I.utf8(before));Object.assign(r.aligned_file,I.identity(f.aligned),{sample_count:44099});r.duration=44099/44100;write(f.record,r);
  assert.throws(()=>cli('validate',{production:f.production,record:f.record}),/PCM conversion changed sample count/);
});
test('HeyGen unfinished audio and checks resume from retained source without synthesis',t=>{
  const f=fixture(t), pcm=I.read(f.o.pcm), pending=I.json(f.o.pcm);
  pending.usable=false;for(const key of ['codec','time_base','sample_count','bytes','sha256','output'])pending[key]=null;
  write(f.o.pcm,pending);const {check,...noCheck}=f.o;
  assert.equal(cli('file',noCheck).eligible,false);
  assert.equal(I.json(f.record).duration,1);assert.equal(I.json(f.record).delay.basis,'pcm');
  assert.throws(()=>cli('current',f.current),/ineligible/);
  const expected=path.join(f.temp,'prior-take.json');fs.writeFileSync(expected,I.read(f.record));
  fs.writeFileSync(f.o.pcm,pcm);cli('file',{...f.o,expected});
  assert.equal(cli('validate',{production:f.production,record:f.record,settings:f.current.settings}).eligible,true);
  cli('current',f.current);
});
test('HeyGen non-English explicit unchecked uses the same registry eligibility rules',t=>{
  const f=fixture(t), call=I.json(f.o.call), settings=I.json(f.current.settings);
  call.inputs.language='fr';settings.language='fr';write(f.o.call,call);write(f.current.settings,settings);
  write(f.o.check,{result:'unchecked',language:'fr'});cli('file',f.o);
  assert.equal(cli('validate',{production:f.production,record:f.record,settings:f.current.settings}).eligible,true);
  cli('current',f.current);assert.equal(I.json(f.registry).settings.language,'fr');
});
