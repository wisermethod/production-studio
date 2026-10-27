#!/usr/bin/env node
'use strict';
const USAGE = `Narration Takes 0.1.0
node scripts/narration-takes.js help
node scripts/narration-takes.js stage --production DIR --scene ID --route ROUTE --source FILE --bytes N --sha256 HASH [--cid UUID]
node scripts/narration-takes.js file --production DIR --stage JSON --prepared JSON --pcm JSON --timings JSON --call JSON [--check JSON] [--expected JSON]
node scripts/narration-takes.js validate --production DIR --record JSON [--settings JSON]
node scripts/narration-takes.js current --production DIR --record JSON --settings JSON --expected JSON
All paths absolute. Each flag once, separate value. ROUTE: elevenlabs or chatterbox.
--expected is an exact prior snapshot; current uses a JSON null file for prior absence.
--help and -h work on every command. Nothing installs; no configuration.
`;
const SCHEMA = {
  stage:[['production','scene','route','source','bytes','sha256'],['cid']],
  file:[['production','stage','prepared','pcm','timings','call'],['check','expected']],
  validate:[['production','record'],['settings']],
  current:[['production','record','settings','expected'],[]]
};
function run(argv) {
  const cmd = argv[0];
  if (['help','--help','-h'].includes(cmd) && argv.length === 1) return USAGE;
  if (!Object.hasOwn(SCHEMA,cmd)) throw new Error('unknown or missing command; run node scripts/narration-takes.js help');
  const [required,optional] = SCHEMA[cmd], o = Object.create(null);
  for (let i=1; i<argv.length; i++) {
    const flag = argv[i];
    if (['--help','-h'].includes(flag)) { o.help = true; continue; }
    const key = flag.slice(2);
    if (!flag.startsWith('--') || ![...required,...optional].includes(key)) throw new Error('unknown flag '+flag+'; run node scripts/narration-takes.js help');
    if (Object.hasOwn(o,key)) throw new Error('repeated flag '+flag+'; pass it once');
    const value = argv[++i];
    if (!value || (key !== 'scene' && value.startsWith('--'))) throw new Error('missing value for '+flag+'; see help');
    o[key] = value;
  }
  if (o.help) return USAGE;
  for (const k of required) if (!Object.hasOwn(o,k)) throw new Error('missing --'+k+'; see help');
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('requires Node >=22; check: node --version');
  const I = require('./io.js');
  // All caller paths are screened before the first input is read or write runs.
  for (const k of ['production','source','stage','prepared','pcm','timings','call','check','expected','record','settings'])
    if (o[k] !== undefined) {
      if (cmd === 'stage' && k === 'source' && I.stat(o[k])?.isSymbolicLink()) throw new Error('source must not be a symbolic link');
      o[k] = I.canonical(o[k]);
    }
  if (cmd === 'stage' && !/^[1-9]\d*$/.test(o.bytes)) throw new Error('--bytes must be a positive integer; use the source answer');
  const M = require('./model.js');
  if (cmd !== 'stage') M.dependency();
  return require('./takes.js')[cmd](o);
}
if (require.main === module) {
  try { const result = run(process.argv.slice(2)); process.stdout.write(typeof result === 'string' ? result : JSON.stringify(result)+'\n'); }
  catch (e) { process.stderr.write('Narration Takes: '+e.message+'\n'); process.exitCode = 1; }
}
module.exports = {run};
