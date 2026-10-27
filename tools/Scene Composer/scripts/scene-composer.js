#!/usr/bin/env node
'use strict';
// Keep the launcher in old JavaScript syntax: help precedes the runtime check.
var USAGE = 'Scene Composer 0.2.1\n' +
  'node scripts/scene-composer.js help\n' +
  'node scripts/scene-composer.js --help\n' +
  'node scripts/scene-composer.js compose --spec <file.json> --output <new dir>\n' +
  'node scripts/scene-composer.js timing --spec <file.json> --output <new dir>\n' +
  'node scripts/scene-composer.js captions --list <file.json> --output <new file.srt>\n' +
  'All paths absolute; each required flag once, with a separate value.\n' +
  'Nothing to install. No configuration. See TOOL.md for the schemas.\n';
function run(argv, version) {
  var command = argv[0];
  var usage = ' Run node scripts/scene-composer.js help.';
  if (command === 'help' || command === '--help') {
    if (argv.length !== 1) throw new Error('unknown argument ' + argv[1] + '.' + usage);
    return USAGE;
  }
  if (command !== 'compose' && command !== 'timing' && command !== 'captions') {
    throw new Error((command ? 'unknown command ' + command : 'missing command') + '.' + usage);
  }
  if (Number((version || process.versions.node).split('.')[0]) < 22) {
    throw new Error(command + ' refuses Node ' + (version || process.versions.node) + '; requires Node >=22. Check node --version.');
  }
  var input = command === 'captions' ? '--list' : '--spec';
  for (var j = 1; j < argv.length; j++) {
    if (argv[j].charAt(0) === '-' && argv[j] !== input && argv[j] !== '--output') {
      throw new Error('unknown argument ' + argv[j] + '.' + usage);
    }
  }
  var flags = Object.create(null);
  for (var i = 1; i < argv.length; i += 2) {
    var flag = argv[i];
    if (flag !== input && flag !== '--output') throw new Error('unknown argument ' + flag + '.' + usage);
    if (flags[flag]) throw new Error('repeated flag ' + flag + '.' + usage);
    if (!argv[i + 1] || argv[i + 1].charAt(0) === '-') throw new Error('missing value for ' + flag + '.' + usage);
    flags[flag] = argv[i + 1];
  }
  if (!flags[input] || !flags['--output']) throw new Error('missing flag ' + (!flags[input] ? input : '--output') + '.' + usage);
  return require('./compose.js')[command](flags[input], flags['--output']);
}
if (require.main === module) {
  try {
    var result = run(process.argv.slice(2));
    process.stdout.write(typeof result === 'string' ? result : require('./rational.js').json(result));
  } catch (error) {
    process.stderr.write('Scene Composer: ' + error.message + '\n');
    process.exitCode = 1;
  }
}
module.exports = { run: run };
