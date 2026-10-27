'use strict';
const { spawnSync } = require('node:child_process');
const I = require('./io.js');
const Q = require('./rational.js');
const { fail, path, fs, equal } = I;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function object(v, name, required, optional = []) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) fail(name + ' must be an object');
  if (Object.keys(v).some(k => !required.includes(k) && !optional.includes(k)) || required.some(k => !Object.hasOwn(v, k)))
    fail(name + ' has missing or unexpected keys; use the documented evidence shape');
}
function integer(v, name, min = 0) {
  if (!Number.isSafeInteger(v) || v < min) fail(name + ' must be a finite safe integer, never a boolean'); return v;
}
function number(v, name, min = 0) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min) fail(name + ' must be a finite number'); return v;
}
function string(v, name) {
  if (typeof v !== 'string' || !v || /[\x00-\x1f\x7f]/.test(v)) fail(name + ' must be nonempty text without controls'); return v;
}
function scene(v) { if (typeof v !== 'string' || !/^[a-z0-9-]+$/.test(v)) fail('scene must use lowercase letters, digits and hyphens'); return v; }
function cid(v) { if (typeof v !== 'string' || !UUID.test(v)) fail('cid must be a UUID'); return v; }
function route(v) { if (!['elevenlabs', 'chatterbox'].includes(v)) fail('route must be elevenlabs or chatterbox'); return v; }
function digest(v) { if (typeof v !== 'string' || !/^[a-f0-9]{64}$/.test(v)) fail('sha256 must be 64 lowercase hexadecimal characters'); }
function fileIdentity(v) { object(v, 'file identity', ['bytes', 'sha256']); integer(v.bytes, 'bytes', 1); digest(v.sha256); }
function matches(file, expected) { fileIdentity(expected); const got = I.identity(file); if (!equal(got, expected)) fail('file bytes or sha256 mismatch; retain the evidence and resolve the differing identity'); return got; }
function scriptTokens(text) {
  if (typeof text !== 'string' || [...text].length < 1 || [...text].length > 5000 || I.utf8(Buffer.from(text)) !== text)
    fail('script must be valid Unicode with 1 to 5,000 code points');
  const plain = text.replace(/\[[^\]]*\]|<[^>]*>/g, '').trim();
  if (!plain) fail('script has no spoken tokens'); return plain.split(/\s+/u);
}
function noAddress(v) {
  if (typeof v === 'string' && (/^[a-z][a-z0-9+.-]*:\/\/|^[/\\]|\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i.test(v)))
    fail('inputs must contain route facts, never an address, path or credential');
  if (v && typeof v === 'object') for (const x of Object.values(v)) noAddress(x);
}
const CHAT_SETTINGS = ['device','exaggeration','cfg_weight','seed','seed_step','max_words','trim_db',
  'mark_gap_s','sentence_gap_s','repetition_penalty','min_p','top_p','temperature',
  'model','package','piece_words'];
function chatterSettings(v) {
  object(v, 'Chatterbox settings', ['device','exaggeration','cfg_weight','seed','trim_db','mark_gap_s','sentence_gap_s'], CHAT_SETTINGS);
  noAddress(v);
  if (v.device !== 'mps') fail('Chatterbox device must be mps');
  if (v.model !== undefined && v.model !== 'ResembleAI/chatterbox') fail('unexpected Chatterbox model');
  if (v.package !== undefined && v.package !== 'chatterbox-tts 0.1.7') fail('unexpected Chatterbox package');
  for (const [k,x] of Object.entries(v)) {
    if (['device','model','package'].includes(k)) string(x,k);
    else if (k === 'seed' && x === "20261026 plus the piece's index") continue; // Saved prototype evidence.
    else if (['seed','seed_step','max_words','piece_words'].includes(k)) integer(x,k, k === 'seed' ? 0 : 1);
    else number(x,k, k === 'trim_db' ? -Infinity : 0);
  }
  if (!Object.hasOwn(v,'max_words') && !Object.hasOwn(v,'piece_words')) fail('Chatterbox settings need max_words or saved prototype piece_words');
}
function inputs(v, r) {
  noAddress(v);
  if (r === 'elevenlabs') {
    object(v, 'ElevenLabs inputs', ['voice_id','model_id']);
    if (typeof v.voice_id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(v.voice_id)) fail('invalid voice_id');
    if (!['eleven_v4','eleven_v4_turbo','eleven_v3','eleven_multilingual_v2'].includes(v.model_id)) fail('invalid model_id');
  } else if (r === 'chatterbox') {
    object(v, 'Chatterbox inputs', ['reference_sha256','settings']); digest(v.reference_sha256); chatterSettings(v.settings);
  } else {
    object(v, 'legacy xAI inputs', ['voice_id','language','timings'], ['speed','sample_rate','bit_rate','text_normalization']);
    string(v.voice_id,'voice_id'); language(v.language);
    if (v.timings !== 'words') fail('legacy timings must be words');
    if (Object.hasOwn(v,'speed')) { number(v.speed,'speed'); if (v.speed < 0.25 || v.speed > 2) fail('speed outside xAI range'); }
    for (const k of ['sample_rate','bit_rate']) if (Object.hasOwn(v,k)) integer(v[k],k,1);
    if (Object.hasOwn(v,'text_normalization') && typeof v.text_normalization !== 'boolean') fail('text_normalization must be boolean');
  }
}
function language(v) { if (typeof v !== 'string' || !/^[A-Za-z]+(?:-[A-Za-z0-9]+)*$/.test(v)) fail('language must be a language code'); }
function english(v) { return /^(?:en|eng)(?:-|$)/i.test(v); }
function settings(v) {
  if (v && Object.hasOwn(v,'route')) {
    route(v.route);
    object(v, 'settings', ['route','language', ...(v.route === 'elevenlabs' ? ['voice_id','model_id'] : ['reference_sha256','settings'])]);
    const { route:r, language:l, ...facts } = v; language(l); inputs(facts,r);
  } else {
    object(v, 'legacy settings', ['voice_id','language'], ['speed','sample_rate','bit_rate','text_normalization']);
    inputs({...v, timings:'words'}, 'xai');
  }
}
function settingsMatch(v, record) {
  settings(v);
  const r = record.route || 'xai';
  if ((v.route || 'xai') !== r) fail('settings route differs from take');
  const {route:ignored, language:l, ...facts} = v;
  const takeFacts = {...record.inputs};
  if (r === 'xai') { delete takeFacts.timings; delete takeFacts.language; }
  if (!equal(facts,takeFacts)) fail('settings differ from the take inputs');
  if (r === 'xai' && l !== record.inputs.language) fail('settings language differs from legacy take');
  if (record.check?.result === 'unchecked' && l !== record.check.language) fail('unchecked language differs from settings');
}
function registry(v) {
  object(v,'narration.json',['settings','scenes']); settings(v.settings); object(v.scenes,'scenes',[],Object.keys(v.scenes || {}));
  for (const [s, entry] of Object.entries(v.scenes)) { scene(s); object(entry,'scene entry',['cid']); cid(entry.cid); }
}
function folder(production, s, write = false) {
  const p = I.canonical(production), st = I.stat(p);
  if (!st?.isDirectory()) fail('production must be an existing directory');
  const dir = I.canonical(path.join(p,'narration',scene(s)));
  if (!I.inside(dir,p) || (write && I.inside(dir,I.TOOL))) fail('scene path escapes production or writes inside the tool');
  return dir;
}
function dependency() {
  const result = spawnSync('ffprobe',['-version'], {encoding:'utf8'});
  if (result.error || result.status !== 0) fail('missing ffprobe; check: ffprobe -version. Resolve the dependency before retrying');
}
function probe(file, packets = false) {
  file = I.regular(file); const extension = path.extname(file).toLowerCase();
  if (!['.mp3','.wav'].includes(extension)) fail('audio must resolve to MP3 or WAV');
  const args = ['-v','error','-protocol_whitelist','file,pipe','-f',extension.slice(1)];
  if (packets) args.push('-select_streams','a:0','-show_packets','-read_intervals','%+#1');
  args.push('-show_streams','-of','json',file);
  const result = spawnSync('ffprobe',args,{encoding:'utf8',maxBuffer:4*1024*1024,timeout:30000});
  if (result.error || result.status !== 0 || result.stderr) fail('ffprobe could not read the named audio; inspect its format');
  const answer = I.parse(result.stdout);
  if (!Array.isArray(answer.streams) || answer.streams.length !== 1 || answer.streams[0].codec_type !== 'audio') fail('audio must have exactly one audio stream');
  const s = answer.streams[0], rate = Number(s.sample_rate), channels = s.channels;
  integer(rate,'audio sample rate',1); integer(channels,'audio channels',1);
  return { ...s, rate, channels, packets:answer.packets };
}
function wav(file) {
  const s = probe(file);
  if (s.codec_name !== 'pcm_s16le' || s.bits_per_sample !== 16 || s.time_base !== '1/'+s.rate) fail('aligned WAV must be 16-bit PCM on a 1/sample_rate clock');
  integer(s.duration_ts,'WAV sample count',1); return s;
}
function decodedSamples(file) {
  const result = spawnSync('ffprobe',['-v','error','-protocol_whitelist','file,pipe','-f','mp3',
    '-select_streams','a:0','-show_frames','-show_entries','frame=nb_samples','-of','json',I.regular(file)],
    {encoding:'utf8',maxBuffer:16*1024*1024,timeout:30000});
  if (result.error || result.status !== 0 || result.stderr) fail('ffprobe could not read the decoded source clock');
  const answer = I.parse(result.stdout);
  if (!Array.isArray(answer.frames) || !answer.frames.length) fail('source has no decoded audio samples');
  const samples = answer.frames.reduce((total,frame) => total + integer(frame.nb_samples,'decoded frame samples',1),0);
  return integer(samples,'decoded source sample count',1);
}
function sourceClock(file) {
  const s = probe(file,true);
  if (path.extname(file).toLowerCase() === '.wav') {
    if (!/^pcm_/.test(s.codec_name) || s.time_base !== '1/'+s.rate) fail('source WAV must be PCM on its sample clock');
    integer(s.duration_ts,'source samples',1);
    return {...s, samples:s.duration_ts, basis:'pcm', removed:0, stated:null};
  }
  if (s.codec_name !== 'mp3') fail('source MP3 codec mismatch');
  s.samples = decodedSamples(file);
  const side = (s.packets?.[0]?.side_data_list || []).filter(x => x.side_data_type === 'Skip Samples');
  if (side.length > 1) fail('ambiguous MP3 Skip Samples');
  if (side.length) { integer(side[0].skip_samples,'stated skip'); return {...s,basis:'header_skip_samples',removed:0,stated:side[0].skip_samples}; }
  if (/LAME[0-9]/.test(I.read(file).toString('latin1'))) return {...s,basis:'lame_no_header',removed:1105,stated:null};
  return {...s,basis:'unknown',removed:0,stated:null};
}
function recordSource(dir, record) { return path.join(dir,record.cid+(record.route === 'chatterbox' ? '.source.wav' : '.mp3')); }
function transcriptPath(dir, id, name, legacy = false) {
  string(name,'transcript');
  const prefix = id + '-transcript-';
  if (!name.startsWith(prefix) || !/^\d{4}-\d\d-\d\d\.txt$/.test(name.slice(prefix.length))) fail('transcript name must match this cid and transcript date');
  const date = name.slice(prefix.length,-4);
  if (!Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10) !== date) fail('transcript name must contain a calendar date');
  const named = path.join(dir,name), file = I.regular(named);
  const text = I.utf8(I.read(file));
  if (file !== named || !text.trim()) fail('transcript must be present and nonempty beside the take');
  // Transcribe Audio's artifact has a header and a nonempty speech body. The
  // audio basename in retained/copy-filed evidence may predate this local cid.
  if (!legacy && !/^TRANSCRIPT\r?\n\r?\nAudio file: [^\r\n]+\.wav\r?\nTranscribed: \d{4}-\d\d-\d\d \d\d:\d\d:\d\d\r?\nModel: [^\r\n]+\r?\n\r?\n\s*\S/.test(text)) fail('transcript format must have Transcribe Audio header and speech body');
  return file;
}
function validateRecord(production, recordPath, providedSettings) {
  const resolved = I.regular(recordPath), record = I.json(resolved);
  const verdict = validateData(production, resolved, record, providedSettings);
  // A validator reports evidence and promotion eligibility separately.
  return {ok:true, valid:true, eligible:verdict.length === 0, reasons:verdict, record:resolved, scene:record.scene, cid:record.cid, legacy:!Object.hasOwn(record,'route')};
}
function validateData(production, resolved, r, providedSettings) {
  object(r,'take',['scene','cid','action','inputs','text','text_sha256','characters','duration','file','date_filed','timings'],['route','delay','aligned_file','check']);
  scene(r.scene); cid(r.cid); const rt = Object.hasOwn(r,'route') ? route(r.route) : 'xai';
  const dir = folder(production,r.scene);
  if (resolved !== path.join(dir,r.cid+'.json')) fail('record path does not match production, scene and cid');
  if (r.action !== ({elevenlabs:'elevenlabs.speech.synthesize',chatterbox:'chatterbox.synthesize',xai:'xai.speech.synthesize'})[rt]) fail('action does not match route');
  inputs(r.inputs,rt); const tokens = scriptTokens(r.text); digest(r.text_sha256);
  if (I.hash(Buffer.from(r.text)) !== r.text_sha256) fail('original text sha256 mismatch');
  integer(r.characters,'characters',1); if (r.characters > 5000) fail('submitted text exceeds 5,000 code points');
  number(r.duration,'duration'); if (r.duration <= 0) fail('duration must be positive');
  if (typeof r.date_filed !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(r.date_filed) || !Number.isFinite(Date.parse(r.date_filed)) || new Date(r.date_filed).toISOString().slice(0,10) !== r.date_filed) fail('date_filed must be a calendar date');
  const source = recordSource(dir,r);
  if (I.regular(source) !== source || I.stat(source).isSymbolicLink()) fail('take source must be a regular file at its filed path');
  matches(source,r.file); const src = sourceClock(source);
  if (rt === 'chatterbox' && src.codec_name !== 'pcm_s24le') fail('Chatterbox source must retain its original 24-bit PCM WAV');
  let length = Q.decimal(I.numberText(r,'duration')), usable = false;
  if (Object.hasOwn(r,'delay')) {
    object(r.delay,'delay',['samples_removed','sample_rate','basis','stated_skip_samples']);
    integer(r.delay.samples_removed,'samples_removed'); integer(r.delay.sample_rate,'sample_rate',1);
    if (r.delay.stated_skip_samples !== null) integer(r.delay.stated_skip_samples,'stated_skip_samples');
    const unknown = r.delay.basis === 'unknown' && r.delay.samples_removed === 0 && r.delay.sample_rate === src.rate && r.delay.stated_skip_samples === null;
    if (!unknown && !equal(r.delay,{samples_removed:src.removed,sample_rate:src.rate,basis:src.basis,stated_skip_samples:src.stated})) fail('delay differs from the source readback');
    if (!Object.hasOwn(r,'aligned_file')) fail('delay requires aligned_file, null for unknown or unfinished audio');
    if (r.delay.basis === 'unknown' && r.aligned_file !== null) fail('unknown delay cannot have aligned audio');
    if (r.aligned_file !== null) {
      object(r.aligned_file,'aligned_file',['name','bytes','sha256','sample_count']);
      if (r.aligned_file.name !== r.cid+'.wav') fail('aligned filename must match cid');
      integer(r.aligned_file.sample_count,'sample_count',1);
      const aligned = I.regular(path.join(dir,r.aligned_file.name));
      if (aligned !== path.join(dir,r.aligned_file.name)) fail('aligned WAV must stay at its filed path');
      matches(aligned,{bytes:r.aligned_file.bytes,sha256:r.aligned_file.sha256}); const a = wav(aligned);
      if (a.rate !== src.rate || a.channels !== src.channels || a.duration_ts !== r.aligned_file.sample_count) fail('aligned WAV clock differs from source or record');
      if (src.basis === 'pcm' && src.duration_ts !== a.duration_ts) fail('PCM conversion changed sample count');
      if (src.basis !== 'pcm' && Math.abs(a.duration_ts - (src.samples-src.removed)) > 1152) fail('aligned sample count differs from decoded source clock by more than one MP3 frame');
      length = [BigInt(a.duration_ts),BigInt(a.rate)];
      // The legacy duration was supplied by xAI, before delay preparation.
      // Only new routes promise the measured aligned duration. All routes'
      // timing bounds still use the actual aligned sample clock below.
      if (rt !== 'xai' && Math.abs(r.duration-a.duration_ts/a.rate) > 1e-9) fail('duration differs from aligned sample clock');
      usable = true;
    }
  } else if (Object.hasOwn(r,'aligned_file')) fail('aligned_file without delay');
  if (!Array.isArray(r.timings) || r.timings.length !== tokens.length) fail('timings must contain every script token once');
  let previous = [0n,1n];
  r.timings.forEach((t,i) => {
    object(t,'timing',['text','start','end']); number(t.start,'word start'); number(t.end,'word end');
    if (t.text !== tokens[i]) fail('timing token differs from original script spelling or order');
    const start = Q.decimal(I.numberText(t,'start')), end = Q.decimal(I.numberText(t,'end'));
    if (Q.compare(start,[0n,1n]) < 0 || Q.compare(end,[0n,1n]) < 0 || Q.compare(start,previous) < 0 || Q.compare(start,end) > 0 || Q.compare(start,length) > 0 || Q.compare(end,length) > 0) fail('word timing is negative, reversed, unordered or past the take length'); previous = start;
  });
  if (r.check !== undefined) {
    if (r.check?.result === 'unchecked') {
      object(r.check,'unchecked check',['result','language']); language(r.check.language);
      if (english(r.check.language)) fail('English cannot be unchecked');
      if (rt === 'xai' && r.check.language !== r.inputs.language) fail('check language differs from take');
    } else {
      object(r.check,'check',['result','transcript']);
      if (!['pass','fail'].includes(r.check.result)) fail('check result must be pass, fail or unchecked');
      transcriptPath(dir,r.cid,r.check.transcript,rt === 'xai');
      if (rt === 'xai' && !english(r.inputs.language) && r.check.result === 'pass') fail('non-English take must use unchecked');
    }
  }
  if (providedSettings) settingsMatch(providedSettings,r);
  matches(source,r.file); // Probe/check work must not change the staged source.
  const reasons = [];
  if (!usable) reasons.push('usable delay and aligned audio are unfinished or unknown');
  if (!r.check) reasons.push('check is unfinished');
  else if (r.check.result === 'fail') reasons.push('check failed');
  else if (r.check.result === 'pass' && !english(providedSettings?.language || (rt === 'xai' ? r.inputs.language : ''))) reasons.push('passing check requires English settings; non-English takes require unchecked');
  return reasons;
}
module.exports = {object,integer,number,string,scene,cid,route,digest,fileIdentity,matches,scriptTokens,inputs,
  settings,settingsMatch,registry,folder,dependency,probe,wav,sourceClock,recordSource,validateRecord,validateData,transcriptPath};
