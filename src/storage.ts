import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertSnapshot, type ScanSnapshot } from './contracts.js';

export function dataHome(): string {
  if (process.env.WOMBAT_DATA_HOME) return path.resolve(process.env.WOMBAT_DATA_HOME);
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'Wombat');
  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'wombat');
}

export async function atomicWrite(file: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.writeFile(temp, content, { mode: 0o600 });
    await fs.rename(temp, file);
  } catch (error) {
    await fs.rm(temp, { force: true }).catch(() => {});
    throw error;
  }
}

export async function saveSnapshot(snapshot: ScanSnapshot): Promise<string> {
  const file = path.join(dataHome(), 'snapshots', `${snapshot.snapshotId}.json`);
  await atomicWrite(file, JSON.stringify(snapshot));
  await atomicWrite(path.join(dataHome(), 'latest.json'), JSON.stringify({ snapshot: file }));
  return file;
}

export async function loadSnapshot(file?: string): Promise<{ path: string; snapshot: ScanSnapshot }> {
  let target = file;
  if (!target) {
    const latest = JSON.parse(await fs.readFile(path.join(dataHome(), 'latest.json'), 'utf8')) as { snapshot?: string };
    target = latest.snapshot;
  }
  if (!target) throw new Error('未找到扫描快照，请先运行 wombat scan');
  const resolved = path.resolve(target);
  const snapshot = assertSnapshot(JSON.parse(await fs.readFile(resolved, 'utf8')));
  return { path: resolved, snapshot };
}
