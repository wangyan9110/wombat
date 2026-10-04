import { createHash } from 'node:crypto';
import { closeSync, lstatSync, openSync, readdirSync, readSync } from 'node:fs';
import path from 'node:path';

export interface PayloadFile { path: string; size: number; sha256: string; executable: boolean }
export const hash = (data: Buffer | string): string => createHash('sha256').update(data).digest('hex');
/** Hash large executables with a fixed buffer rather than retaining the entire runtime. */
export function hashFile(file: string): string {
  const digest = createHash('sha256'), buffer = Buffer.allocUnsafe(1024 * 1024), fd = openSync(file, 'r');
  try {
    let bytes: number;
    while ((bytes = readSync(fd, buffer, 0, buffer.length, null)) > 0) digest.update(buffer.subarray(0, bytes));
    return digest.digest('hex');
  } finally {closeSync(fd);}
}
export function inventory(directory: string, relative = '', budget = {entries: 10000}): PayloadFile[] {
  const root = lstatSync(path.join(directory, relative));
  if (root.isSymbolicLink() || !root.isDirectory()) throw new Error('Payload directory must be a real directory');
  if (relative.split('/').length > 32) throw new Error('Payload directory depth exceeds limit');
  return readdirSync(path.join(directory, relative)).sort().flatMap(name => {
    if (--budget.entries < 0) throw new Error('Payload entry count exceeds limit');
    const entry = relative ? relative + '/' + name : name;
    const file = path.join(directory, entry), stat = lstatSync(file);
    if (stat.isSymbolicLink()) throw new Error('Symlink in payload: ' + entry);
    if (stat.isDirectory()) return inventory(directory, entry, budget);
    if (!stat.isFile()) throw new Error('Non-file in payload: ' + entry);
    if (stat.size > 512 * 1024 * 1024) throw new Error('Payload file exceeds size limit: '+entry);
    return [{ path: entry, size: stat.size, sha256: hashFile(file), executable: (stat.mode & 0o111) !== 0 }];
  });
}
