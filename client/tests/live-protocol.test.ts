import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, type Socket } from 'node:net';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { queryLive } from '../src/node/live.js';

test('live client accepts a split response without waiting for server EOF', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'wombat-wire-'));
  const endpoint = process.platform === 'win32' ? `\\\\.\\pipe\\wombat-test-${randomUUID()}` : path.join(dir, 'socket');
  const connections = new Set<Socket>();
  const server = createServer(socket => {
    connections.add(socket);
    socket.once('data', () => {
      socket.write('{"ok":true,"value":{"marker":"complete"}}');
      setImmediate(() => socket.write('\n')); // Deliberately keep the server end open.
    });
    socket.once('close', () => connections.delete(socket));
  });
  try {
    server.listen(endpoint); await once(server, 'listening');
    const binaryPath = path.join(dir, 'endpoint.cjs');
    const response = JSON.stringify({ ok: true, value: { protocolVersion: 1, socket: endpoint } });
    await writeFile(binaryPath, `process.stdin.resume();process.stdin.on('end',()=>console.log(${JSON.stringify(response)}));`);
    await chmod(binaryPath, 0o700);
    assert.deepEqual(await queryLive({ query: { action: 'usage' } }, {}, { binaryPath, timeoutMs: 1000 }), { marker: 'complete' });
  } finally {
    for (const connection of connections) connection.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});
