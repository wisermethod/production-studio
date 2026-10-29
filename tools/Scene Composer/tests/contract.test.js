'use strict';
const { test }=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {spawnSync}=require('node:child_process');
const {fixture,call,ok,refused,tree,TOOL,ENTRY}=require('./support.js');
const {run}=require('../scripts/scene-composer.js');
const {normalize}=require('../scripts/spec.js');
const {frame,parse,rational:q}=require('../scripts/rational.js');
function compose(f){return ['compose','--spec',f.save(),'--output',f.output];}
function bad(name,change,pattern=/Correct|help/){test(name,t=>{const f=fixture(t);change(f.spec,f);const args=compose(f),before=tree(f.dir);refused(args,pattern);assert.deepEqual(tree(f.dir),before);});}
const seconds=s=>({seconds:s}),word=(s,n=1)=>({word:s,occurrence:n});

test('help before version and no imports on old runtimes',()=>{
  assert.match(run(['help'],'0.1.0'),/Scene Composer 0.4.0/);
  assert.match(run(['--help'],'0.1.0'),/--spec/);
  for(const c of ['compose','captions'])assert.throws(()=>run([c],'21.9.0'),new RegExp(`${c} refuses Node 21`));
  for(const c of ['help','--help']){const r=call([c]);assert.equal(r.status,0);assert.equal(r.stderr,'');}
});
test('importing the entry has no effects',()=>{const r=spawnSync(process.execPath,['-e','require(process.argv[1])',ENTRY],{encoding:'utf8'});assert.equal(r.status,0);assert.equal(r.stdout+r.stderr,'');});
for(const args of [[],['dance'],['--install'],['help','--bad'],['compose','--install'],['compose','--env'],['compose','--spec'],['compose'],['captions','--spec','/x'],['compose','--spec','x','--spec','y'],['compose','extra'],['compose','--output','--strange']]) {
  test(`CLI refusal ${args.join(' ')||'empty'}`,()=>{const r=refused(args,/help/);const token=args.find(s=>s==='dance'||s.startsWith('--')&& !['--spec','--output'].includes(s));if(token)assert.ok(r.stderr.includes(token));});
}
test('exact rational decimals and frame boundary arithmetic',()=>{
  assert.equal(frame(4.1,30),123);assert.equal(frame('4.10000000000000001',30),124);
  assert.equal(frame('0.07',100),7);assert.equal(frame('1e-3',1000),1);
  assert.equal(frame(q('0.1').add(q('0.2')),30),9);
  assert.equal(frame(parse('{"t":4.10000000000000001}').t,30),124);
});
test('sample length, defaults and exact arrival/start frames',t=>{
  const f=fixture(t);f.spec.lead=0.1;f.spec.tail=0.2;f.record.aligned_file.sample_count=240001;f.save(f.record,'take.json');
  f.spec.cursor={start:{x:0,y:0},moves:[{x:80,y:40,at:word('Save.',2)}]};
  const r=ok(compose(f));assert.equal(r.frames,160);assert.equal(r.duration,160/30);
  assert.deepEqual(r.events,[{kind:'cursor',seconds:4.2,frame:126,start_frame:99}]);
  delete f.spec.lead;delete f.spec.tail;assert.equal(normalize(f.spec).data.frames,173);
});
test('two output directories are byte identical, hashes verify and JSON keys are sorted',t=>{
  const f=fixture(t),args=compose(f),a=ok(args),other=path.join(f.dir,'other');
  ok(['compose','--spec',path.join(f.dir,'spec.json'),'--output',other]);
  assert.deepEqual(tree(f.output),tree(other));
  const {createHash}=require('node:crypto');
  for(const item of a.files)assert.equal(item.sha256,createHash('sha256').update(fs.readFileSync(path.join(f.output,item.path))).digest('hex'));
  const raw=fs.readFileSync(path.join(f.output,'compose.json'),'utf8');assert.ok(raw.endsWith('\n'));assert.equal(raw.includes(f.output),false);
  assert.equal(a.compose_sha256,createHash('sha256').update(raw).digest('hex'));
  function sorted(v){if(v&&typeof v==='object'){if(!Array.isArray(v))assert.deepEqual(Object.keys(v),Object.keys(v).sort());Object.values(v).forEach(sorted);}}sorted(JSON.parse(raw));
});
for(const [name,value] of [['relative','relative'],['private','.env'],['credential','credentials.json'],['memory','memory/new'],['parent missing','absent/new']]) {
  test(`output path refused: ${name}`,t=>{const f=fixture(t),input=f.save(),output=name==='relative'?value:path.join(f.dir,value),before=tree(f.dir);refused(['compose','--spec',input,'--output',output],/absolute|protected|parent/);assert.deepEqual(tree(f.dir),before);});
}
test('existing outputs, tool outputs, symlink escapes, loops and bad input paths refused',t=>{
  const f=fixture(t),input=f.save();
  fs.mkdirSync(path.join(f.dir,'exists'));
  fs.symlinkSync(TOOL,path.join(f.dir,'alias'));
  fs.symlinkSync(path.join(f.dir,'loop'),path.join(f.dir,'loop'));
  fs.symlinkSync(path.join(f.dir,'missing'),path.join(f.dir,'dangling'));
  for(const out of [path.join(f.dir,'exists'),path.join(TOOL,'new'),path.join(f.dir,'alias','new'),path.join(f.dir,'loop','new'),path.join(f.dir,'dangling','new')])refused(['compose','--spec',input,'--output',out],/exists|tool|canonicalized|symbolic link/);
  for(const source of ['relative',path.join(f.dir,'.env'),path.join(f.dir,'memory','input'),f.dir,path.join(f.dir,'missing')])refused(['compose','--spec',source,'--output',f.output],/absolute|protected|file/);
  assert.equal(fs.existsSync(f.output),false);
});
test('source links resolve to canonical paths and protected targets are never opened',t=>{
  const f=fixture(t);fs.symlinkSync(path.join(f.dir,'still.png'),path.join(f.dir,'alias'));
  f.spec.still.path=path.join(f.dir,'alias');ok(compose(f));
  fs.symlinkSync(path.join(f.dir,'memory','missing'),path.join(f.dir,'protected'));
  f.spec.still.path=path.join(f.dir,'protected');refused(['compose','--spec',f.save(),'--output',path.join(f.dir,'no')],/symbolic link|protected/);
});
for(const [name,raw] of [['invalid','{'],['duplicate','{"frame":{},"frame":{}}'],['trailing','{} true'],['invalid escape','{"a":"\\q"}']])test(`JSON ${name}`,t=>{const f=fixture(t);const input=path.join(f.dir,'bad.json');fs.writeFileSync(input,raw);const before=tree(f.dir);refused(['compose','--spec',input,'--output',f.output],/JSON|duplicate/);assert.deepEqual(tree(f.dir),before);});
const unknown=[['spec',s=>s],['frame',s=>s.frame],['still',s=>s.still],['take',s=>s.take],['colors',s=>s.colors={}],['font',s=>(s.fonts=[{family:'F',path:'/unused'}])[0]],['chip',s=>s.chip={text:'T',at:seconds(1),until:seconds(2)}],['cursor',s=>s.cursor={start:{x:0,y:0},moves:[]}],['cursor.start',s=>(s.cursor={start:{x:0,y:0},moves:[]}).start],['cursor.move',s=>(s.cursor={start:{x:0,y:0},moves:[{x:1,y:1,at:seconds(1)}]}).moves[0]],['click',s=>(s.clicks=[{at:seconds(1)}])[0]],['camera',s=>(s.camera=[{rect:'full',at:seconds(1)}])[0]],['camera.rect',s=>(s.camera=[{rect:{x:0,y:0,w:10,h:10},at:seconds(1)}])[0].rect],['callout',s=>(s.callouts=[{rect:{x:0,y:0,w:10,h:10},label:'T',at:seconds(1),until:seconds(2)}])[0]],['callout.rect',s=>(s.callouts=[{rect:{x:0,y:0,w:10,h:10},label:'T',at:seconds(1),until:seconds(2)}])[0].rect],['captions',s=>s.captions={}],['caption',s=>(s.captions={lines:[{text:'Open',at:word('Open')}]}).lines[0]],['at',s=>(s.clicks=[{at:seconds(1)}])[0].at],['until',s=>(s.chip={text:'T',at:seconds(1),until:seconds(2)}).until],['caption.style',s=>(s.captions={mode:'drawn',style:{}}).style]];
for(const [name,get]of unknown)bad(`unknown key at ${name}`,s=>get(s).unexpected=true,/unknown key .*unexpected/);
for(const [name,change,pattern]of [
 ['missing frame',s=>delete s.frame,/missing field/],['odd frame',s=>s.frame.width=321,/even/],['zero fps',s=>s.frame.fps=0,/fps/],['boolean fps',s=>s.frame.fps=true,/number/],['fractional fps',s=>s.frame.fps=29.97,/integer/],['negative lead',s=>s.lead=-1,/lead/],['negative tail',s=>s.tail=-1,/tail/],['no duration',s=>delete s.take,/duration/],['both duration and take',s=>s.duration=5,/mutually/],['no word take',s=>{delete s.take;s.duration=5;s.camera=[{rect:'full',at:word('Open')}];},/without take/],
 ['word absent',s=>s.camera=[{rect:'full',at:word('save.')}],/absent/],['occurrence absent',s=>s.camera=[{rect:'full',at:word('Save.',3)}],/absent/],['occurrence zero',s=>s.camera=[{rect:'full',at:word('Save.',0)}],/integer/],['mixed at',s=>s.camera=[{rect:'full',at:{seconds:1,word:'Open',occurrence:1}}],/needs seconds/],['event past end',s=>s.camera=[{rect:'full',at:seconds(5.001)}],/past/],['until equal',s=>s.chip={text:'A',at:seconds(1),until:seconds(1)},/until/],['until reversed',s=>s.chip={text:'A',at:seconds(2),until:seconds(1)},/until/],['until past end',s=>s.chip={text:'A',at:seconds(1),until:seconds(6)},/past/],
 ['cursor point outside',s=>s.cursor={start:{x:161,y:1},moves:[]},/outside/],['cursor move outside',s=>s.cursor={start:{x:0,y:0},moves:[{x:0,y:91,at:seconds(1)}]},/outside/],['camera rect outside',s=>s.camera=[{rect:{x:150,y:0,w:11,h:10},at:seconds(1)}],/outside/],['zero rect',s=>s.camera=[{rect:{x:0,y:0,w:0,h:10},at:seconds(1)}],/positive/],['negative rect',s=>s.camera=[{rect:{x:-1,y:0,w:10,h:10},at:seconds(1)}],/nonnegative/],['callout rect outside',s=>s.callouts=[{rect:{x:0,y:89,w:1,h:2},label:'T',at:seconds(1),until:seconds(2)}],/outside/],['click without cursor',s=>s.clicks=[{at:seconds(1)}],/require cursor/],
 ['camera order',s=>s.camera=[{rect:'full',at:seconds(2)},{rect:'full',at:seconds(1)}],/out of time order/],['cursor order',s=>s.cursor={start:{x:0,y:0},moves:[{x:1,y:1,at:seconds(2)},{x:2,y:2,at:seconds(1)}]},/out of time order/],['click order',s=>{s.cursor={start:{x:0,y:0},moves:[]};s.clicks=[{at:seconds(2)},{at:seconds(1)}];},/out of time order/],['callout order',s=>s.callouts=[2,1].map(n=>({rect:{x:0,y:0,w:10,h:10},label:'T',at:seconds(n),until:seconds(n+1)})),/out of time order/],['caption order',s=>s.captions={lines:[{text:'Save.',at:word('Save.',2)},{text:'Open',at:word('Open')}]},/out of time order/],['caption collision',s=>s.captions={lines:[{text:'Open',at:seconds(0.001)},{text:'Open',at:seconds(0.01)}]},/distinct/],
 ['missing font for chip',s=>s.chip={text:'T',at:seconds(0),until:seconds(1)},/requires at least/],['missing font for label',s=>s.callouts=[{rect:{x:0,y:0,w:10,h:10},label:'T',at:seconds(0),until:seconds(1)}],/requires at least/],['bad color',s=>s.colors={background:'url(https://invalid)'},/hex color/],['bad caption mode',s=>s.captions={mode:'auto'},/mode/],['style forbidden',s=>s.captions={style:{}},/refused/],['drawn needs style',s=>s.captions={mode:'drawn'},/style/],['caption empty',s=>s.captions={lines:[{text:'',at:seconds(0)}]},/nonempty/]
])bad(name,change,pattern);
for(const key of ['timings','aligned_file','delay'])bad(`take missing ${key}`,(s,f)=>{delete f.record[key];f.save(f.record,'take.json');},/take record requires/);
for(const [name,change]of [['sample count',r=>delete r.aligned_file.sample_count],['sample rate',r=>delete r.delay.sample_rate],['zero rate',r=>r.delay.sample_rate=0],['reversed word',r=>r.timings[0].end=0],['word beyond take',r=>r.timings[0].end=6],['unordered words',r=>r.timings.reverse()]])bad(`bad take ${name}`,(s,f)=>{change(f.record);f.save(f.record,'take.json');});
bad('corrupt image header',(s,f)=>fs.writeFileSync(s.still.path,'not an image'),/PNG or JPEG/);
bad('bad font header',(s,f)=>{s.fonts=[f.font];fs.writeFileSync(f.font.path,'bad');},/font must/);
bad('duplicate font',(s,f)=>s.fonts=[f.font,f.font],/duplicate font/);
bad('font weight outside range',(s,f)=>s.fonts=[{...f.font,weight:1001}],/weight/);
bad('font style outside set',(s,f)=>s.fonts=[{...f.font,style:'sideways'}],/style/);

test('SRT comes from frames, including last word hold, even in none mode',t=>{
  const f=fixture(t);f.spec.captions={lines:[{text:'Open Save.',at:word('Open')},{text:'Save.',at:word('Save.',2)}]};
  const r=ok(compose(f));assert.equal(fs.readFileSync(path.join(f.output,'captions.srt'),'utf8'),'1\n00:00:00,100 --> 00:00:04,100\nOpen Save.\n\n2\n00:00:04,100 --> 00:00:04,900\nSave.\n\n');
  assert.equal(r.captions[1].end_frame,147);
});
test('caption text may differ from the spoken words, and the last line holds past the take\'s last word',t=>{
  const f=fixture(t);f.spec.captions={lines:[{text:'Open wisermemory.com/install',at:word('Open')},{text:'Save it: Ctrl+S',at:word('Save.',2)}]};
  const r=ok(compose(f));const srt=fs.readFileSync(path.join(f.output,'captions.srt'),'utf8');
  assert.match(srt,/Open wisermemory\.com\/install/);assert.match(srt,/Save it: Ctrl\+S/);
  assert.equal(r.captions[1].end_frame,147);
});
bad('duplicate key in the take record',(s,f)=>fs.writeFileSync(s.take.record,JSON.stringify(f.record).replace('"timings":','"timings":[],"timings":')),/duplicate key timings/);
test('the still is drawn unrotated, and labels are placed without measuring',t=>{
  const f=fixture(t);f.spec.fonts=[f.font];f.spec.callouts=[{rect:{x:10,y:10,w:20,h:20},label:'Right',at:seconds(0),until:seconds(1)},{rect:{x:120,y:10,w:30,h:20},label:'Left',at:seconds(0),until:seconds(1)},{rect:{x:40,y:10,w:80,h:20},label:'Inside',at:seconds(0),until:seconds(1)}];
  ok(compose(f));
  const css=fs.readFileSync(path.join(f.output,'project','style.css'),'utf8'),js=fs.readFileSync(path.join(f.output,'project','scene.js'),'utf8');
  assert.match(css,/#still \{ image-orientation: none;/);
  assert.doesNotMatch(js,/offsetWidth|offsetHeight|getBoundingClientRect/);
});
test('every label box stays inside the still, for any rectangle',()=>{
  const {placeLabel}=require('../scripts/page.js');
  const n=v=>v===undefined?undefined:Number(String(v).replace('px',''));
  const box=(W,H,st)=>{const mw=n(st.maxWidth),mh=n(st.maxHeight);
    const x0=st.left!==undefined?n(st.left):W-n(st.right)-mw, y0=st.top!==undefined?n(st.top):H-n(st.bottom)-mh;
    return [x0,y0,x0+mw,y0+mh];};
  const cases=[[160,90,{x:10,y:50,w:40,h:20}],[160,90,{x:40,y:80,w:80,h:10}],[160,90,{x:40,y:10,w:80,h:20}],[100,100,{x:70,y:10,w:20,h:40}],[160,90,{x:120,y:10,w:30,h:20}],[1280,800,{x:560,y:340,w:300,h:120}]];
  for(const W of [100,160,640,1280])for(const H of [90,100,360,800])for(let x=0;x<W;x+=Math.ceil(W/7))for(let y=0;y<H;y+=Math.ceil(H/7))for(const w of [1,30,90])for(const h of [1,20,60])if(x+w<=W&&y+h<=H)cases.push([W,H,{x,y,w,h}]);
  for(const [W,H,r] of cases){const [x0,y0,x1,y1]=box(W,H,placeLabel(W,H,r));
    assert.ok(x0>=0&&y0>=0&&x1<=W&&y1<=H&&x1-x0>=Math.min(80,W)&&y1-y0>=Math.min(48,H),JSON.stringify({W,H,r,box:[x0,y0,x1,y1]}));}
});
test('no take, empty SRT, explicit seconds captions and scene-end cap',t=>{
  const f=fixture(t);delete f.spec.take;f.spec.duration=0.41;
  let r=ok(compose(f));assert.equal(r.frames,13);assert.equal(fs.readFileSync(path.join(f.output,'captions.srt'),'utf8'),'');
  f.spec.captions={lines:[{text:'Untimed words',at:seconds(0.1)}]};
  const out=path.join(f.dir,'captions');ok(['compose','--spec',f.save(),'--output',out]);
  assert.equal(fs.readFileSync(path.join(out,'captions.srt'),'utf8'),'1\n00:00:00,100 --> 00:00:00,433\nUntimed words\n\n');
});
test('linked fonts, optional drawn captions, self-contained seek and no external resources',t=>{
  const f=fixture(t);f.spec.fonts=[f.font];f.spec.chip={text:'<script>literal</script>',at:seconds(0),until:seconds(2)};
  f.spec.captions={mode:'drawn',lines:[{text:'Open',at:word('Open')}],style:{font:'Local',size:18,weight:400,color:'#fff',background:'none',padding:4,radius:3,position:'bottom',margin:8,max_width:300}};
  ok(compose(f));const css=fs.readFileSync(path.join(f.output,'project/style.css'),'utf8'),html=fs.readFileSync(path.join(f.output,'project/index.html'),'utf8'),js=fs.readFileSync(path.join(f.output,'project/scene.js'),'utf8');
  assert.match(css,/@font-face/);assert.match(css,/font-001.woff2/);assert.equal((html.match(/data-video-root/g)||[]).length,1);
  assert.match(html,/href="style.css"/);assert.doesNotMatch(js,/setTimeout|requestAnimationFrame|setInterval|Date\(/);assert.doesNotMatch(css,/\btransition\s*:|\banimation\s*:/);assert.doesNotMatch(css+js,/will-change/,'video-render 0.2.0 forbids will-change inside the zooming camera');
  assert.doesNotMatch(js,/\/var\/|\.json"/);
  // Execute the actual emitted listener with a tiny DOM, including backwards seeks.
  const elements=new Map();
  function el(){return {style:{},children:[],appendChild(e){this.children.push(e);},offsetWidth:20,offsetHeight:10};}
  for(const id of ['camera','cursor','root','chip'])elements.set(id,el());
  let listener;const document={getElementById:id=>elements.get(id),createElement:()=>el()},window={addEventListener:(name,fn)=>{assert.equal(name,'video-render:seek');listener=fn;}};
  vm.runInNewContext(js,{document,window});
  const snap=()=>JSON.stringify([...elements].map(([k,e])=>[k,e.style,e.children.map(c=>[c.style,c.textContent])]));
  listener({detail:{time:1}});const a=snap();listener({detail:{time:4}});listener({detail:{time:0}});listener({detail:{time:1}});assert.equal(snap(),a);
});
