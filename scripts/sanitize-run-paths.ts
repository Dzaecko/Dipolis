/**
 * Offline, deliberately conservative report sanitizer (Node >= 22.18).
 *
 * Review first:
 *   node scripts\sanitize-run-paths.ts --dry-run --backup-dir <absolute-new-external-directory>
 * Apply the same command without --dry-run only after reviewing its plan.
 *
 * The backup parent must already exist. The backup directory must not exist.
 * All files, including unchanged/unsupported extensions, are backed up as exact
 * bytes under files/docs/results/model-runs, with SHA-256 hashes in manifest.json.
 * Keep that private backup outside version control: it contains the original paths.
 * Quiesce report writers before applying. Writes are atomic per file, not as a
 * batch; on an I/O failure, retain the backup and inspect the reported failure.
 * No network access, model calls, or git operations are performed.
 */
import { createHash, randomUUID } from 'node:crypto';
import {
 existsSync, lstatSync, mkdirSync, openSync, closeSync, fsyncSync, readFileSync,
 readdirSync, realpathSync, renameSync, unlinkSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scope = path.join('docs', 'results', 'model-runs');
const formats = new Set(['.jsonl', '.json', '.html', '.log', '.csv']);
const redaction = '[redacted-local-path]';
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const portable = (name: string) => name.split(path.sep).join('/');

function within(parent: string, child: string): boolean {
 const relative = path.relative(parent, child);
 return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function unsupported(text: string): void {
 // These require decoding or platform-specific resolution; never guess.
 if (/(?:\bfile:|~(?:[A-Za-z0-9._-]+)?[\\/]|%[A-Za-z_]+%|\$(?:env:(?:USERPROFILE|HOME|HOMEDRIVE|HOMEPATH)|HOME|\{HOME\})|\\u(?:002f|005c|003a)|&#(?:x(?:2f|5c|3a)|(?:47|92|58));|%2f|%5c)/i.test(text)
  || /(?:^|[\s"'=>(])(?:\\\\|(?<!:)\/\/)[A-Za-z0-9][A-Za-z0-9._-]*[\\/][A-Za-z0-9._-]+/m.test(text)
  || /(?:^|[\s"'=>(])[A-Za-z]:(?![\\/])\S/m.test(text)
  || /(?:^|[\s"'=>(])\\(?:Users|home)[\\/]/i.test(text)) {
  throw new Error('Unsupported path construct; manual review required');
 }
}

function localPath(value: string, repoRoot: string): string {
 const windows = /^[A-Za-z]:[\\/]/.test(value);
 const normalized = value.replace(/\\{2}/g, '\\').replace(/\\/g, '/');
 if (/[\x00-\x1f<>&"'`%?#*:]/.test(normalized.slice(windows ? 2 : 0))
  || normalized.split('/').some(segment => segment === '..' || segment === '.')
  || /\/{2}/.test(normalized)) {
  throw new Error('Unparseable or ambiguous absolute path; manual review required');
 }
 const root = repoRoot.replace(/\\/g, '/').replace(/\/$/, '');
 const actual = windows ? normalized.toLowerCase() : normalized;
 const base = windows ? root.toLowerCase() : root;
 if (actual === base) return '.';
 if (actual.startsWith(`${base}/`)) return normalized.slice(root.length + 1) || '.';
 return redaction;
}

export function sanitizeText(text: string, repoRoot: string, wholeField = false): string {
 unsupported(text);
 // POSIX web URLs/route names are not local paths. Known home/system prefixes
 // and the supplied POSIX repo root are recognized; other forms need review.
 const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
 const posixRoot = repoRoot.startsWith('/') ? `|${escape(repoRoot)}(?=/|$)` : '';
 const start = new RegExp(`[A-Za-z]:[\\\\/]+|/(?:Users|home|root|tmp|var|private|opt|etc|mnt|Volumes)(?=/|$)${posixRoot}`, 'g');
 for (const candidate of text.matchAll(/(?:^|[\s"'`=])(\/[A-Za-z0-9][^\s"'<>`,;|(){}\[\]&]*)/g)) {
  const absolute = candidate[1];
  if (absolute === undefined) throw new Error('Invalid absolute path candidate');
  if (/^\/(?:v1|openai\/v1)\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\.?$/.test(absolute)) continue;
  if (!new RegExp(`^(?:${start.source})`).test(absolute)) {
   throw new Error('Unsupported or ambiguous POSIX absolute path; manual review required');
  }
 }
 let result = '';
 let cursor = 0;
 for (const match of text.matchAll(start)) {
  const offset = match.index;
  if (offset < cursor) continue;
  const previous = text[offset - 1];
  if (previous !== undefined && /[\p{L}\p{N}/\\:]/u.test(previous)) {
   if (/^[A-Za-z]:[\\/]+(?:Users|home)[\\/]/i.test(text.slice(offset))) {
    throw new Error('Ambiguous embedded absolute path; manual review required');
   }
   continue;
  }
  let end: number;
  const before = text.slice(0, offset);
  const quote = before.endsWith('&quot;') ? '&quot;' : /["'`]$/.exec(before)?.[0];
  if (wholeField && offset === 0 && !/[\r\n]/.test(text)) {
   end = text.length;
  } else if (quote) {
   end = text.indexOf(quote, offset);
   if (end === -1) throw new Error('Unterminated quoted absolute path');
  } else {
   const suffix = text.slice(offset);
   end = offset + (/[\s"'<>`,;|(){}\[\]&]/.exec(suffix)?.index ?? suffix.length);
   const candidate = text.slice(offset, end);
   const normalizedCandidate = candidate.replace(/\\/g, '/').toLowerCase();
   const normalizedRoot = repoRoot.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase();
   const isUnquotedRepoPath = normalizedCandidate === normalizedRoot ||
    normalizedCandidate.startsWith(`${normalizedRoot}/`);
   if (/^[ \t]+\S/.test(text.slice(end)) && !isUnquotedRepoPath) {
    throw new Error('Ambiguous unquoted absolute path; quote the path before sanitizing');
   }
  }
  const candidate = text.slice(offset, end);
  if (quote && /^\s*:/.test(text.slice(end + quote.length))) {
   throw new Error('Absolute path used as a raw structured key; manual review required');
  }
  if (/[&%?#]/.test(text[end] ?? '') && !(quote === '&quot;' && text.startsWith(quote, end))) {
   throw new Error('Unsupported encoded or decorated absolute path');
  }
  result += text.slice(cursor, offset) + localPath(candidate, repoRoot);
  cursor = end;
 }
 return result + text.slice(cursor);
}

function sanitizeJson(text: string, repoRoot: string, lines: boolean): string {
 const validate = (value: string) => {
  if (lines) {
   for (const line of value.split(/\r?\n/)) if (line.trim()) JSON.parse(line);
  } else JSON.parse(value);
 };
 validate(text);
 const result = text.replace(/"(?:[^"\\]|\\.)*"/g, token => {
  const decoded: unknown = JSON.parse(token);
  if (typeof decoded !== 'string') throw new Error('Invalid JSON string');
  const sanitized = sanitizeText(decoded, repoRoot, true);
  return sanitized === decoded ? token : JSON.stringify(sanitized);
 });
 validate(result);
 const containers: (Set<string> | null)[] = [];
 for (const token of result.matchAll(/"(?:[^"\\]|\\.)*"|[{}\[\]]/g)) {
  if (token[0] === '{') containers.push(new Set());
  else if (token[0] === '[') containers.push(null);
  else if (token[0] === '}' || token[0] === ']') containers.pop();
  else if (/^\s*:/.test(result.slice(token.index + token[0].length))) {
   const keys = containers.at(-1);
   const key: string = JSON.parse(token[0]);
   if (!keys || keys.has(key)) throw new Error('Duplicate JSON key after sanitization; manual review required');
   keys.add(key);
  }
 }
 return result;
}

function sanitizeCsv(text: string, repoRoot: string): string {
 let cursor = 0;
 let result = '';
 while (cursor < text.length) {
  const start = cursor;
  const quoted = text[cursor] === '"';
  let value = '';
  if (quoted) {
   ++cursor;
   let closed = false;
   while (cursor < text.length) {
    if (text[cursor] !== '"') value += text[cursor++];
    else if (text[cursor + 1] === '"') { value += '"'; cursor += 2; }
    else { ++cursor; closed = true; break; }
   }
   if (!closed) throw new Error('Unterminated CSV field');
   if (cursor < text.length && !/[,\r\n]/.test(text[cursor] ?? '')) throw new Error('Invalid CSV quoting');
  } else {
   while (cursor < text.length && !/[,\r\n]/.test(text[cursor] ?? '')) {
    if (text[cursor] === '"') throw new Error('Invalid CSV quoting');
    value += text[cursor++];
   }
  }
  const sanitized = sanitizeText(value, repoRoot, true);
  result += sanitized === value ? text.slice(start, cursor)
   : quoted ? `"${sanitized.replace(/"/g, '""')}"` : sanitized;
  if (cursor < text.length) {
   const delimiter = text[cursor++];
   result += delimiter;
   if (delimiter === '\r') {
    if (text[cursor] !== '\n') throw new Error('Invalid CSV line ending');
    result += text[cursor++];
   }
  }
 }
 return result;
}

export function sanitizeBytes(bytes: Buffer, extension: string, repoRoot: string): Buffer {
 const bom = bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]));
 const payload = bom ? bytes.subarray(3) : bytes;
 const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(payload);
 if (text.includes('\0')) throw new Error('Unsupported binary content');
 let result: string;
 if (extension === '.jsonl' || extension === '.json') result = sanitizeJson(text, repoRoot, extension === '.jsonl');
 else if (extension === '.csv') result = sanitizeCsv(text, repoRoot);
 else {
  result = sanitizeText(text, repoRoot);
  if (!formats.has(extension) && result !== text) throw new Error('Path in unsupported report format');
 }
 return result === text ? bytes : Buffer.concat([bom ? bytes.subarray(0, 3) : Buffer.alloc(0), Buffer.from(result)]);
}

interface PlannedFile {
 name: string;
 original: Buffer;
 replacement: Buffer;
 mode: number;
}

export interface SanitizeOptions {
 repoRoot: string;
 backupDirectory: string;
 dryRun?: boolean;
}

function inventory(root: string, directory = path.join(root, scope)): string[] {
 const stat = lstatSync(directory);
 if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Report directories must be real directories');
 const files: string[] = [];
 for (const entry of readdirSync(directory).sort()) {
  const filename = path.join(directory, entry);
  const info = lstatSync(filename);
  if (info.isSymbolicLink()) throw new Error('Symlink in report tree; refusing traversal');
  if (info.isDirectory()) files.push(...inventory(root, filename));
  else if (info.isFile()) files.push(path.relative(root, filename));
  else throw new Error('Non-regular file in report tree');
 }
 return files;
}

function validateDirectories(options: SanitizeOptions): { root: string; backup: string } {
 const root = realpathSync(options.repoRoot);
 if (!existsSync(path.join(root, '.git'))) throw new Error('Expected repository root with .git');
 let current = root;
 for (const component of scope.split(path.sep)) {
  current = path.join(current, component);
  if (lstatSync(current).isSymbolicLink()) throw new Error('Symlink in report directory ancestry');
 }
 if (!path.isAbsolute(options.backupDirectory)) throw new Error('Backup directory must be explicitly absolute');
 const requested = path.resolve(options.backupDirectory);
 const backup = path.join(realpathSync(path.dirname(requested)), path.basename(requested));
 if (within(root, backup)) throw new Error('Backup directory must be outside repository');
 if (existsSync(backup)) throw new Error('Backup directory must be new and must not already exist');
 // existsSync follows links, so explicitly reject dangling links too.
 if (readdirSync(path.dirname(backup)).includes(path.basename(backup))) throw new Error('Backup path already exists');
 return { root, backup };
}

function durableWrite(filename: string, bytes: Buffer, mode: number): void {
 const descriptor = openSync(filename, 'wx', mode);
 try {
  writeFileSync(descriptor, bytes);
  fsyncSync(descriptor);
 } finally { closeSync(descriptor); }
}

function assertUnchanged(root: string, file: PlannedFile): void {
 const filename = path.join(root, file.name);
 let directory = root;
 for (const component of path.dirname(file.name).split(path.sep)) {
  directory = path.join(directory, component);
  if (lstatSync(directory).isSymbolicLink()) throw new Error('Report directory became a symlink');
 }
 if (lstatSync(filename).isSymbolicLink() || !readFileSync(filename).equals(file.original)) {
  throw new Error(`Report changed during sanitization: ${portable(file.name)}`);
 }
}

export function sanitizeRunPaths(options: SanitizeOptions) {
 const { root, backup } = validateDirectories(options);
 const names = inventory(root);
 const files: PlannedFile[] = names.map(name => {
  const filename = path.join(root, name);
  const original = readFileSync(filename);
  try {
   return { name, original, replacement: sanitizeBytes(original, path.extname(name).toLowerCase(), root),
    mode: lstatSync(filename).mode };
  } catch (error) {
   // Do not print report content or the sensitive absolute paths in diagnostics.
   throw new Error(`Cannot sanitize ${portable(name)}: ${error instanceof SyntaxError ? 'Invalid JSON' : error instanceof Error ? error.message : 'Unknown error'}`);
  }
 });
 const changed = files.filter(file => !file.original.equals(file.replacement));
 const summary = {
  dryRun: Boolean(options.dryRun), backupDirectory: backup,
  totalFiles: files.length, affectedFiles: changed.length,
  backupBytes: files.reduce((sum, file) => sum + file.original.length, 0),
  files: files.map(file => ({ name: portable(file.name), changed: !file.original.equals(file.replacement),
   originalSha256: digest(file.original), sanitizedSha256: digest(file.replacement) })),
 };
 if (options.dryRun) return summary;

 mkdirSync(backup, { mode: 0o700 });
 for (const file of files) {
  const destination = path.join(backup, 'files', file.name);
  mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  durableWrite(destination, file.original, 0o600);
  if (!readFileSync(destination).equals(file.original)) throw new Error('Backup byte verification failed');
 }
 durableWrite(path.join(backup, 'manifest.json'), Buffer.from(JSON.stringify(summary, null, 2) + '\n'), 0o600);
 if (JSON.stringify(inventory(root)) !== JSON.stringify(names)) throw new Error('Report inventory changed during backup');
 for (const file of files) assertUnchanged(root, file);

 const staged: { file: PlannedFile; temporary: string }[] = [];
 try {
  for (const file of changed) {
   const temporary = path.join(root, `${file.name}.sanitize-${randomUUID()}.tmp`);
   // Register first so a failed write is also cleaned up.
   staged.push({ file, temporary });
   durableWrite(temporary, file.replacement, file.mode & 0o777);
  }
  for (const { file, temporary } of staged) {
   assertUnchanged(root, file);
   renameSync(temporary, path.join(root, file.name));
  }
  for (const file of files) {
   if (!readFileSync(path.join(root, file.name)).equals(file.replacement)) {
    throw new Error(`Post-write verification failed: ${portable(file.name)}`);
   }
  }
 } finally {
  for (const { temporary } of staged) if (existsSync(temporary)) unlinkSync(temporary);
 }
 return summary;
}

export function parseArguments(args: string[]): SanitizeOptions {
 let backupDirectory: string | undefined;
 let dryRun = false;
 for (let index = 0; index < args.length; ++index) {
  const argument = args[index];
  if (argument === '--dry-run' && !dryRun) dryRun = true;
  else if (argument === '--backup-dir' && backupDirectory === undefined) {
   backupDirectory = args[++index];
   if (!backupDirectory || backupDirectory.startsWith('--')) throw new Error('Missing backup directory');
  } else throw new Error(`Unknown or duplicate argument: ${argument}`);
 }
 if (!backupDirectory) throw new Error('Required: --backup-dir <absolute-new-external-directory>');
 return { repoRoot: fileURLToPath(new URL('..', import.meta.url)), backupDirectory, dryRun };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
 try {
  console.log(JSON.stringify(sanitizeRunPaths(parseArguments(process.argv.slice(2))), null, 2));
 } catch (error) {
  console.error(error instanceof Error ? error.message : 'Sanitization failed');
  process.exitCode = 1;
 }
}
