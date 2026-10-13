import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import {
 existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArguments, sanitizeBytes, sanitizeRunPaths, sanitizeText } from './sanitize-run-paths.ts';

const windowsRoot = 'C:\\Users\\private-person\\repos\\Dipolis';
const relativeReport = 'docs/results/model-runs/run.jsonl';

function fixture(t: TestContext) {
 const base = mkdtempSync(path.join(os.tmpdir(), 'dipolis-path-test-'));
 const root = path.join(base, 'repo');
 const reports = path.join(root, 'docs', 'results', 'model-runs');
 mkdirSync(reports, { recursive: true });
 mkdirSync(path.join(root, '.git'));
 const backup = path.join(base, 'backup');
 t.after(() => rmSync(base, { recursive: true, force: true }));
 return { root, reports, backup, options: { repoRoot: root, backupDirectory: backup } };
}

test('repo paths become portable relative paths, with boundary and case checks', () => {
 assert.equal(sanitizeText(`${windowsRoot}\\${relativeReport.replace(/\//g, '\\')}`, windowsRoot), relativeReport);
 assert.equal(sanitizeText(`${windowsRoot.toUpperCase()}/docs/test.log`, windowsRoot), 'docs/test.log');
 assert.equal(sanitizeText(windowsRoot, windowsRoot), '.');
 assert.equal(sanitizeText(`${windowsRoot}\\`, windowsRoot), '.');
 assert.equal(sanitizeText(`${windowsRoot}-other\\secret.log`, windowsRoot), '[redacted-local-path]');
 assert.equal(sanitizeText('/home/alice/repo/docs/file.log', '/home/alice/repo'), 'docs/file.log');
});

test('external user paths redact the entire path, without retaining usernames', () => {
 for (const name of ['D:\\Users\\alice\\private.txt', 'C:/Users/bob/report.log',
  '/Users/charlie/report.log', '/home/dana/report.log', '/root/report.log', '/tmp/private.txt']) {
  assert.equal(sanitizeText(name, windowsRoot), '[redacted-local-path]');
 }
});

test('quoted spaces and doubled backslashes in log/HTML paths are supported', () => {
 const root = 'C:\\Users\\alice\\Repo Space';
 assert.equal(sanitizeText(`Saved "${root}\\docs\\my file.log"\n`, root), 'Saved "docs/my file.log"\n');
 const escaped = `${windowsRoot}\\docs\\run.jsonl`.replace(/\\/g, '\\\\');
 assert.equal(sanitizeText(`  "output": "${escaped}",\r\n`, windowsRoot), '  "output": "docs/run.jsonl",\r\n');
 assert.equal(sanitizeText(`<pre>&quot;${escaped}&quot;</pre>`, windowsRoot), '<pre>&quot;docs/run.jsonl&quot;</pre>');
});

test('JSONL validates every line and changes string values and keys, not other bytes', () => {
 const source = `\ufeff{ "output": ${JSON.stringify(`${windowsRoot}\\docs\\run.jsonl`)}, "n": 1.00 }\r\n`
  + `{"${windowsRoot.replace(/\\/g, '\\\\')}":"unchanged","external":"/home/alice/a"}\r\n`;
 const actual = sanitizeBytes(Buffer.from(source), '.jsonl', windowsRoot).toString();
 assert.equal(actual, '\ufeff{ "output": "docs/run.jsonl", "n": 1.00 }\r\n'
  + '{".":"unchanged","external":"[redacted-local-path]"}\r\n');
 assert.throws(() => sanitizeBytes(Buffer.from('{"ok":true}\ninvalid\n'), '.jsonl', windowsRoot));
});

test('JSON and JSONL preserve valid unrelated escaping, UTF-8, BOM, and line endings', () => {
 const bytes = Buffer.from('\ufeff{"message":"Grüße","unicode":"\\u0041","url":"https://example.com/home/alice"}\r\n');
 assert.deepEqual(sanitizeBytes(bytes, '.json', windowsRoot), bytes);
 assert.deepEqual(sanitizeBytes(bytes, '.jsonl', windowsRoot), bytes);
 assert.throws(() => sanitizeBytes(Buffer.from([0xff]), '.log', windowsRoot), /encoded data/);
 assert.throws(() => sanitizeBytes(Buffer.from('a\0b'), '.log', windowsRoot), /binary/);
});

test('JSON key collisions and unsupported raw structured keys fail rather than losing data', () => {
 const collision = '{"/home/alice/a":1,"/home/bob/b":2}';
 assert.throws(() => sanitizeBytes(Buffer.from(collision), '.json', windowsRoot), /Duplicate JSON key/);
 assert.throws(() => sanitizeBytes(Buffer.from('{"a":1,"a":2}'), '.json', windowsRoot), /Duplicate JSON key/);
 assert.throws(() => sanitizeText('"/home/alice/a":1', windowsRoot), /raw structured key/);
 assert.equal(sanitizeBytes(Buffer.from('{"a":1,"nested":{"a":2}}\n{"a":3}\n'), '.jsonl', windowsRoot).toString(),
  '{"a":1,"nested":{"a":2}}\n{"a":3}\n');
});

test('CSV quoting, embedded commas/newlines, and CRLF survive sanitization', () => {
 const input = `path,note\r\n"${windowsRoot}\\docs\\my file.log","a,b\r\n""quoted"""\r\n/home/alice/a,plain\r\n`;
 assert.equal(sanitizeBytes(Buffer.from(input), '.csv', windowsRoot).toString(),
  'path,note\r\n"docs/my file.log","a,b\r\n""quoted"""\r\n[redacted-local-path],plain\r\n');
 for (const invalid of ['"unclosed', '"closed"x,ok', 'un"quoted,ok', 'a\rb']) {
  assert.throws(() => sanitizeBytes(Buffer.from(invalid), '.csv', windowsRoot));
 }
});

test('HTML and ordinary logs preserve URLs, markup, and relative paths', () => {
 const input = '<a href="https://example.com/home/alice">docs/foo.html</a>\nhttp://www.w3.org/2000/svg\n';
 assert.equal(sanitizeText(input, windowsRoot), input);
 const prose = 'Maßnahmen gesetzt:\\nSteuer: 7\nprofile: koexistenz\n';
 assert.equal(sanitizeText(prose, windowsRoot), prose);
});

test('HTML Unicode escapes for comparison symbols are preserved but escaped path separators are rejected', () => {
 assert.equal(sanitizeText('threshold ?\\u003e? capacity and ?\\u003c? 0', windowsRoot),
  'threshold ?\\u003e? capacity and ?\\u003c? 0');
 assert.throws(() => sanitizeText('\\\\u002fUsers\\\\alice\\\\private', windowsRoot));
 assert.throws(() => sanitizeText('C:\\\\u005cUsers\\\\alice\\\\private', windowsRoot));
});

test('escaped markdown line breaks and scheme URLs are not treated as UNC paths', () => {
 assert.equal(sanitizeText('\\\\n- report text\n<img src="http://cdn.example.test/chart.svg">', windowsRoot),
  '\\\\n- report text\n<img src="http://cdn.example.test/chart.svg">');
 assert.throws(() => sanitizeText('\\\\server\\share\\private', windowsRoot));
});

test('Windows drive detection does not mistake German prose before an escaped newline', () => {
 assert.equal(sanitizeText('Optionen für:\\n- nächste Zeile', windowsRoot),
  'Optionen für:\\n- nächste Zeile');
});

test('HTML apostrophe entities are preserved while encoded path separators fail closed', () => {
 assert.equal(sanitizeText('owner&#39;s zone', windowsRoot), 'owner&#39;s zone');
 assert.throws(() => sanitizeText('C:&#92;Users&#92;alice', windowsRoot));
 assert.throws(() => sanitizeText('&#47;home&#47;alice', windowsRoot));
});

test('API endpoint paths in recorded adapter diagnostics remain ordinary text', () => {
 assert.equal(sanitizeText('Provider endpoint /v1/chat/completions. rejected the request', windowsRoot),
  'Provider endpoint /v1/chat/completions. rejected the request');
 assert.equal(sanitizeText('Provider endpoint POST /openai/v1/chat/completions failed', windowsRoot),
  'Provider endpoint POST /openai/v1/chat/completions failed');
 assert.throws(() => sanitizeText('Private file /srv/alice/key', windowsRoot));
});

test('unsupported, encoded, ambiguous, and traversal paths fail closed', () => {
 for (const input of ['file:///C:/Users/alice/a', '\\\\server\\share\\a', '//server/share/a',
  'C:relative.txt', '\\Users\\alice\\a', '~/private', '%USERPROFILE%\\a', '$HOME/a',
  'C:\\Users\\alice\\..\\bob\\a', 'C:\\Users\\alice\\a?secret', 'C:\\Users\\alice\\a%2fb',
  'C:\\Users\\alice\\a more words', '"C:\\Users\\alice\\a', 'C:\\Users\\alice\\a\\u005csecret',
  'C:&#92;Users&#92;alice', 'C:/Users/alice/a&b', '/srv/alice/private', '"\\nC:\\Users\\alice\\a"',
  '~alice/private', '$env:USERPROFILE\\private']) {
  assert.throws(() => sanitizeText(input, windowsRoot), Error, input);
 }
});

test('dry-run reports counts/hashes without creating backups or rewriting any file', t => {
 const { reports, backup, options } = fixture(t);
 writeFileSync(path.join(reports, 'run.log'), '"C:\\Users\\alice\\private.log"\r\n');
 writeFileSync(path.join(reports, 'README.md'), 'unchanged\r\n');
 const before = readFileSync(path.join(reports, 'run.log'));
 const result = sanitizeRunPaths({ ...options, dryRun: true });
 assert.equal(result.totalFiles, 2);
 assert.equal(result.affectedFiles, 1);
 assert.equal(result.backupBytes, before.length + Buffer.byteLength('unchanged\r\n'));
 assert.equal(result.files[1]?.originalSha256.length, 64);
 assert.equal(existsSync(backup), false);
 assert.deepEqual(readFileSync(path.join(reports, 'run.log')), before);
});

test('apply backs up ALL original bytes, including nested and unchanged reports, before rewriting', t => {
 const { root, reports, backup, options } = fixture(t);
 mkdirSync(path.join(reports, 'nested'));
 const originals = new Map([
  ['run.log', Buffer.from('\ufeff"C:\\Users\\alice\\private.log"\r\n')],
  ['README.md', Buffer.from('unchanged\r\n')],
  [path.join('nested', 'review.json'), Buffer.from('{"path":"/home/bob/private"}\n')],
 ]);
 for (const [name, bytes] of originals) writeFileSync(path.join(reports, name), bytes);
 writeFileSync(path.join(root, 'outside.log'), '/home/not-in-scope/file');
 const result = sanitizeRunPaths(options);
 assert.equal(result.totalFiles, 3);
 assert.equal(result.affectedFiles, 2);
 for (const [name, bytes] of originals) {
  assert.deepEqual(readFileSync(path.join(backup, 'files', 'docs', 'results', 'model-runs', name)), bytes);
 }
 assert.equal(readFileSync(path.join(reports, 'run.log'), 'utf8'), '\ufeff"[redacted-local-path]"\r\n');
 assert.equal(readFileSync(path.join(root, 'outside.log'), 'utf8'), '/home/not-in-scope/file');
 assert.deepEqual(JSON.parse(readFileSync(path.join(backup, 'manifest.json'), 'utf8')), result);
 assert.ok(readdirSync(reports).every(name => !name.includes('.sanitize-')));
 assert.throws(() => sanitizeRunPaths(options), /must be new/);
 const again = sanitizeRunPaths({ ...options, backupDirectory: path.join(path.dirname(backup), 'second'), dryRun: true });
 assert.equal(again.affectedFiles, 0);
});

test('preflight failures leave every source unchanged and create no backup', t => {
 const { reports, backup, options } = fixture(t);
 writeFileSync(path.join(reports, 'a.log'), '"C:\\Users\\alice\\private"');
 writeFileSync(path.join(reports, 'z.jsonl'), 'not json');
 assert.throws(() => sanitizeRunPaths(options), /Invalid JSON/);
 assert.equal(existsSync(backup), false);
 assert.equal(readFileSync(path.join(reports, 'a.log'), 'utf8'), '"C:\\Users\\alice\\private"');
 writeFileSync(path.join(reports, 'z.jsonl'), '{}');
 writeFileSync(path.join(reports, 'unsupported.md'), '/home/alice/private');
 assert.throws(() => sanitizeRunPaths(options), /unsupported report format/);
 assert.equal(existsSync(backup), false);
});

test('requires an explicit new external absolute backup, rejecting in-repo aliases', t => {
 const { root, options, backup } = fixture(t);
 assert.throws(() => sanitizeRunPaths({ ...options, backupDirectory: 'relative' }), /absolute/);
 assert.throws(() => sanitizeRunPaths({ ...options, backupDirectory: path.join(root, 'backup') }), /outside/);
 assert.throws(() => sanitizeRunPaths({ ...options, backupDirectory: path.join(backup, 'missing', 'backup') }));
 const alias = path.join(path.dirname(backup), 'repo-alias');
 symlinkSync(root, alias, process.platform === 'win32' ? 'junction' : 'dir');
 assert.throws(() => sanitizeRunPaths({ ...options, backupDirectory: path.join(alias, 'backup') }), /outside/);
});

test('symlinked report directories fail before creating a backup', t => {
 const { reports, backup, options } = fixture(t);
 const outside = path.join(path.dirname(backup), 'external');
 mkdirSync(outside);
 symlinkSync(outside, path.join(reports, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
 assert.throws(() => sanitizeRunPaths(options), /Symlink/);
 assert.equal(existsSync(backup), false);
});

test('all byte-verified backups and the manifest exist before the first atomic rename', t => {
 const { reports, backup, options } = fixture(t);
 const originals = new Map([['a.log', Buffer.from('"C:\\Users\\alice\\a"')],
  ['b.log', Buffer.from('"C:\\Users\\bob\\b"')], ['README.md', Buffer.from('unchanged')]]);
 for (const [name, bytes] of originals) writeFileSync(path.join(reports, name), bytes);
 const rename = fs.renameSync;
 let renames = 0;
 t.mock.method(fs, 'renameSync', (...args: Parameters<typeof fs.renameSync>) => {
  assert.ok(existsSync(path.join(backup, 'manifest.json')));
  for (const [name, bytes] of originals) {
   assert.deepEqual(readFileSync(path.join(backup, 'files', 'docs', 'results', 'model-runs', name)), bytes);
   if (renames === 0) assert.deepEqual(readFileSync(path.join(reports, name)), bytes);
  }
  ++renames;
  return rename(...args);
 });
 syncBuiltinESMExports();
 try {
  assert.equal(sanitizeRunPaths(options).affectedFiles, 2);
  assert.equal(renames, 2);
 } finally {
  t.mock.restoreAll();
  syncBuiltinESMExports();
 }
});

test('backup I/O failure prevents every rewrite and retains the original backup bytes', t => {
 const { reports, backup, options } = fixture(t);
 const original = Buffer.from('"C:\\Users\\alice\\a"');
 writeFileSync(path.join(reports, 'a.log'), original);
 const open = fs.openSync;
 t.mock.method(fs, 'openSync', (...args: Parameters<typeof fs.openSync>) => {
  if (args[0].toString().endsWith('manifest.json')) throw new Error('Simulated backup I/O failure');
  return open(...args);
 });
 syncBuiltinESMExports();
 try {
  assert.throws(() => sanitizeRunPaths(options), /Simulated backup I\/O failure/);
  assert.deepEqual(readFileSync(path.join(reports, 'a.log')), original);
  assert.deepEqual(readFileSync(path.join(backup, 'files', 'docs', 'results', 'model-runs', 'a.log')), original);
 } finally {
  t.mock.restoreAll();
  syncBuiltinESMExports();
 }
});

test('partial atomic-write failure is explicit, keeps all backups, and removes staging files', t => {
 const { reports, backup, options } = fixture(t);
 const original = Buffer.from('"C:\\Users\\alice\\a"');
 writeFileSync(path.join(reports, 'a.log'), original);
 writeFileSync(path.join(reports, 'b.log'), original);
 const rename = fs.renameSync;
 let renames = 0;
 t.mock.method(fs, 'renameSync', (...args: Parameters<typeof fs.renameSync>) => {
  if (++renames === 2) throw new Error('Simulated rename failure');
  return rename(...args);
 });
 syncBuiltinESMExports();
 try {
  assert.throws(() => sanitizeRunPaths(options), /Simulated rename failure/);
  assert.equal(readFileSync(path.join(reports, 'a.log'), 'utf8'), '"[redacted-local-path]"');
  assert.deepEqual(readFileSync(path.join(reports, 'b.log')), original);
  for (const name of ['a.log', 'b.log']) {
   assert.deepEqual(readFileSync(path.join(backup, 'files', 'docs', 'results', 'model-runs', name)), original);
  }
  assert.deepEqual(readdirSync(reports), ['a.log', 'b.log']);
 } finally {
  t.mock.restoreAll();
  syncBuiltinESMExports();
 }
});

test('source mutations during backup fail explicitly instead of overwriting concurrent changes', t => {
 const { reports, backup, options } = fixture(t);
 const original = Buffer.from('"C:\\Users\\alice\\a"');
 writeFileSync(path.join(reports, 'a.log'), original);
 const open = fs.openSync;
 const write = fs.writeFileSync;
 t.mock.method(fs, 'openSync', (...args: Parameters<typeof fs.openSync>) => {
  if (args[0].toString().endsWith('manifest.json')) write(path.join(reports, 'a.log'), 'concurrent change');
  return open(...args);
 });
 syncBuiltinESMExports();
 try {
  assert.throws(() => sanitizeRunPaths(options), /Report changed during sanitization/);
  assert.equal(readFileSync(path.join(reports, 'a.log'), 'utf8'), 'concurrent change');
  assert.deepEqual(readFileSync(path.join(backup, 'files', 'docs', 'results', 'model-runs', 'a.log')), original);
 } finally {
  t.mock.restoreAll();
  syncBuiltinESMExports();
 }
});

test('CLI refuses missing, unknown, duplicate, and target override arguments', () => {
 for (const args of [[], ['--dry-run'], ['--backup-dir'], ['--backup-dir', '--dry-run'],
  ['--backup-dir', 'x', '--backup-dir', 'y'], ['--target', 'elsewhere'],
  ['--backup-dir', 'x', '--dry-run', '--dry-run']]) {
  assert.throws(() => parseArguments(args));
 }
 assert.equal(parseArguments(['--dry-run', '--backup-dir', 'x']).dryRun, true);
});
