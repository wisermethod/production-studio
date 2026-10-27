'use strict';
const I = require('./io.js');
const M = require('./model.js');
const {fs,path,fail} = I;
function narration(production) {
  const p = I.canonical(production), dir = I.canonical(path.join(p,'narration'));
  if (!I.stat(p)?.isDirectory() || !I.inside(dir,p) || I.inside(dir,I.TOOL)) fail('narration must be inside an existing production and outside this tool');
  return dir;
}
function stage(o) {
  M.route(o.route); M.scene(o.scene);
  const expected = {bytes:Number(o.bytes),sha256:o.sha256}; M.fileIdentity(expected);
  // Do not follow a link at the named source, even if its target is regular.
  I.canonical(o.source);
  if (I.stat(o.source)?.isSymbolicLink()) fail('source must not be a symbolic link');
  const source = I.regular(o.source);
  let id;
  if (o.route === 'elevenlabs') {
    id = M.cid(path.basename(source,'.mp3'));
    if (path.basename(source) !== id+'.mp3' || path.basename(path.dirname(source)) !== 'outputs') fail('gateway source must be UUID.mp3 directly inside outputs');
    if (o.cid !== undefined && M.cid(o.cid) !== id) fail('cid differs from gateway source name');
    if (I.inside(I.canonical(o.production),path.dirname(path.dirname(source)))) fail('production must resolve outside the gateway home');
  } else {
    if (o.cid !== undefined) fail('local stage generates its own UUID; omit --cid');
    if (path.extname(source).toLowerCase() !== '.wav') fail('local source must resolve to WAV');
    id = I.crypto.randomUUID();
  }
  const dir = M.folder(o.production,o.scene,true);
  const output = I.destination(path.join(dir,id+(o.route === 'chatterbox' ? '.source.wav' : '.mp3')));
  M.matches(source,expected);
  fs.mkdirSync(dir,{recursive:true});
  // Exclusive copy works on the same device and across volumes; no rename may
  // overwrite an existing take. No gateway directory is enumerated or opened.
  fs.copyFileSync(source,output,fs.constants.COPYFILE_EXCL);
  const fd = fs.openSync(output,'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  M.matches(output,expected); M.matches(source,expected);
  if (o.route === 'elevenlabs') fs.unlinkSync(source);
  return {ok:true,route:o.route,scene:o.scene,cid:id,source:output,file:expected};
}
function prepared(v, rt) {
  M.object(v,'prepared text',['version','route','script','submitted','tokens','words','correspondence']);
  if (v.version !== 1 || v.route !== rt) fail('prepared text version or route mismatch');
  for (const field of ['script','submitted']) {
    M.object(v[field],field,['text','code_points','sha256']);
    M.scriptTokens(v[field].text); M.digest(v[field].sha256);
    if (v[field].code_points !== [...v[field].text].length || v[field].sha256 !== I.hash(Buffer.from(v[field].text))) fail('prepared text hash or code-point count mismatch');
  }
  const tokens = M.scriptTokens(v.script.text);
  if (!I.equal(tokens,v.tokens) || !I.equal(tokens,v.words) || !Array.isArray(v.correspondence) || v.correspondence.length !== tokens.length) fail('prepared original tokens mismatch');
  let previous = 0; const submitted = [...v.submitted.text];
  v.correspondence.forEach((c,i) => {
    M.object(c,'correspondence',['script_index','script_token','route_word','route_start','route_end','spoken_start','spoken_end']);
    if (c.script_index !== i || c.script_token !== tokens[i]) fail('prepared correspondence does not identify the script token');
    for (const k of ['route_start','route_end','spoken_start','spoken_end']) M.integer(c[k],k);
    if (c.route_start < previous || c.route_end <= c.route_start || c.spoken_start < c.route_start || c.spoken_end <= c.spoken_start || c.spoken_end > c.route_end || c.route_end > submitted.length || submitted.slice(c.route_start,c.route_end).join('') !== c.route_word) fail('invalid prepared correspondence bounds');
    previous = c.route_end;
  });
}
function file(o) {
  const dir = narration(o.production); fs.mkdirSync(dir,{recursive:true});
  return locked(dir,()=>fileUnlocked(o));
}
function fileUnlocked(o) {
  const st = I.json(o.stage); M.object(st,'stage result',['ok','route','scene','cid','source','file']);
  if (st.ok !== true) fail('stage was not successful');
  M.route(st.route); M.scene(st.scene); M.cid(st.cid);
  const dir = M.folder(o.production,st.scene,true), recordPath = I.destination(path.join(dir,st.cid+'.json'),false);
  const expectedSource = path.join(dir,st.cid+(st.route === 'chatterbox' ? '.source.wav' : '.mp3'));
  if (I.regular(st.source) !== expectedSource) fail('stage source does not match this production, scene and cid');
  M.matches(expectedSource,st.file);
  const p = I.json(o.prepared); prepared(p,st.route);
  const call = I.json(o.call); M.object(call,'call',['action','inputs']); M.inputs(call.inputs,st.route);
  const pcm = I.json(o.pcm);
  M.object(pcm,'PCM descriptor',['ok','usable','basis','removed','stated','rate','channels','codec','time_base','sample_count','bytes','sha256','output','source']);
  M.object(pcm.source,'PCM source',['path','before','after']);
  if (pcm.ok !== true || typeof pcm.usable !== 'boolean') fail('PCM descriptor must report its usable state');
  if (I.regular(pcm.source.path) !== expectedSource || !I.equal(pcm.source.before,st.file) || !I.equal(pcm.source.after,st.file)) fail('PCM source identity differs from staged source');
  let a;
  if (pcm.usable) {
    if (I.regular(pcm.output) !== path.join(dir,st.cid+'.wav')) fail('PCM output must be cid.wav beside the source');
    a = M.wav(pcm.output);
    M.matches(pcm.output,{bytes:pcm.bytes,sha256:pcm.sha256});
    if (pcm.codec !== a.codec_name || pcm.rate !== a.rate || pcm.channels !== a.channels || pcm.time_base !== a.time_base || pcm.sample_count !== a.duration_ts) fail('PCM descriptor differs from WAV readback');
  } else if (['codec','time_base','sample_count','bytes','sha256','output'].some(k => pcm[k] !== null)) {
    fail('unusable PCM descriptor must have null WAV fields; retain the source for completion');
  }
  const src = M.sourceClock(expectedSource);
  if (pcm.rate !== src.rate || pcm.channels !== src.channels) fail('PCM descriptor differs from source clock');
  const record = {scene:st.scene,cid:st.cid,route:st.route,action:call.action,inputs:call.inputs,
    text:p.script.text,text_sha256:p.script.sha256,characters:p.submitted.code_points,
    duration:a ? a.duration_ts/a.rate : src.samples/src.rate,file:st.file,date_filed:new Date().toISOString().slice(0,10),timings:I.json(o.timings),
    delay:{samples_removed:pcm.removed,sample_rate:pcm.rate,basis:pcm.basis,stated_skip_samples:pcm.stated},
    aligned_file:a ? {name:st.cid+'.wav',bytes:pcm.bytes,sha256:pcm.sha256,sample_count:pcm.sample_count} : null};
  if (o.check) record.check = I.json(o.check);
  let oldBytes = null;
  if (I.stat(recordPath)) {
    if (!o.expected) fail('take record already exists; pass its exact expected snapshot only to finish it');
    if (I.regular(o.expected) === recordPath) fail('expected must be a separate prior snapshot, not the live take');
    oldBytes = I.read(recordPath);
    if (!oldBytes.equals(I.read(o.expected))) fail('take differs from expected prior state; reread it');
    const old = I.parse(I.utf8(oldBytes));
    if (!Object.hasOwn(old,'route')) fail('legacy takes are read-only and are never rewritten');
    // Completion cannot replace a check already decided or any original evidence.
    const completingAudio = old.aligned_file === null && record.aligned_file !== null;
    for (const key of Object.keys(old)) {
      if (key === 'date_filed' || (completingAudio && ['delay','aligned_file','duration'].includes(key))) continue;
      if (!I.equal(old[key],record[key])) fail('completion would change existing take evidence; retain it');
    }
    record.date_filed = old.date_filed;
  } else if (o.expected) fail('expected prior take is absent; reread before completion');
  M.validateData(o.production,recordPath,record);
  if (oldBytes) replace(recordPath,I.encode(record),oldBytes);
  else replace(recordPath,I.encode(record),null);
  return M.validateRecord(o.production,recordPath);
}
// Transaction siblings are in the same directory. The lock serializes this
// tool's writers; snapshots also catch changes from writers that do not lock.
function replace(target, bytes, prior) {
  const temp = I.destination(path.join(path.dirname(target),'.narration-takes-'+I.crypto.randomUUID()+'.tmp'));
  let created = false;
  try {
    I.writeNew(temp,bytes); created = true;
    if (prior === null ? I.stat(target) !== null : !I.read(target).equals(prior)) fail('changed prior state; reread the record and retry');
    fs.renameSync(temp,target);
  } finally { if (created && I.stat(temp)) fs.unlinkSync(temp); }
}
function locked(dir, run) {
  const lock = I.canonical(path.join(dir,'.narration-takes.lock'));
  try { fs.mkdirSync(lock); } catch (e) { if (e.code === 'EEXIST') fail('narration writer lock exists; inspect an interrupted writer before retrying'); throw e; }
  try { return run(); } finally { fs.rmdirSync(lock); }
}
function validate(o) {
  const requested = o.settings ? I.json(o.settings) : undefined;
  const record = I.json(o.record);
  let applicable = requested, registryMatch = null;
  const regPath = path.join(narration(o.production),'narration.json');
  if (I.stat(regPath)) {
    if (I.regular(regPath) !== regPath) fail('narration.json must stay at its production path');
    const reg = I.json(regPath); M.registry(reg);
    if (reg.scenes[record.scene]?.cid === record.cid) {
      // A re-voice rewrites the registry's settings with its first new take while other scenes still point at
      // older takes, so a current take filed under other settings is reported for the caller to narrate again,
      // never refused as malformed.
      try { M.settingsMatch(reg.settings,record); registryMatch = true; } catch (e) { registryMatch = false; }
      if (!applicable && registryMatch) applicable = reg.settings;
    }
  }
  const result = M.validateRecord(o.production,o.record,applicable);
  return registryMatch === null ? result : {...result,registry_settings_match:registryMatch};
}
function current(o) {
  const dir = narration(o.production), regPath = I.destination(path.join(dir,'narration.json'),false);
  if (I.regular(o.expected) === regPath) fail('expected must be a separate prior snapshot, not the live registry');
  const expectedBytes = I.read(o.expected), expected = I.parse(I.utf8(expectedBytes));
  if (expected !== null) M.registry(expected);
  const settings = I.json(o.settings); M.settings(settings);
  fs.mkdirSync(dir,{recursive:true});
  return locked(dir,() => {
    const readPrior = () => I.stat(regPath) ? I.read(regPath) : null;
    const prior = readPrior();
    if (expected === null ? prior !== null : prior === null || !prior.equals(expectedBytes)) fail('narration.json differs from expected prior state; reread it');
    const registry = prior ? I.parse(I.utf8(prior)) : {settings,scenes:{}};
    M.registry(registry);
    const v = M.validateRecord(o.production,o.record,settings);
    if (!v.eligible) fail('take is valid retained evidence but ineligible for current: '+v.reasons.join('; '));
    registry.settings = settings; registry.scenes[v.scene] = {cid:v.cid};
    // Revalidate media and check immediately before publishing, then reread the
    // registry. A prior validation result is never a promotion authorization.
    const final = M.validateRecord(o.production,o.record,settings);
    if (!final.eligible) fail('take became ineligible; finish its evidence before current');
    replace(regPath,I.encode(registry),prior);
    if (!I.equal(I.json(regPath),registry)) fail('registry readback differs; inspect concurrent work');
    return {ok:true,current:{scene:v.scene,cid:v.cid},registry:regPath};
  });
}
module.exports = {stage,file,validate,current,prepared};
