import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { nativeCodexFixture } from '../helpers/native-codex.js';

async function close(server: Server) {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

for (const mode of ['reused', 'owned', 'silent'] as const) {
  const title = mode === 'owned' ? 'lifecycle cleanup still rejects a live owned process'
    : mode === 'silent' ? 'lifecycle cleanup cannot claim exit when identity probes time out'
    : 'lifecycle cleanup ignores reused PIDs and ports with a different identity';
  test(title, { timeout: 10_000 }, async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'wombat-native-lifecycle-'));
    const sockets = new Set<Socket>();
    const server = createServer(socket => {
      sockets.add(socket);
      socket.on('error', () => {});
      socket.once('close', () => sockets.delete(socket));
      if (mode !== 'silent') socket.end(mode === 'owned' ? 'owned-fixture' : 'another-process');
    });
    let closed = false;
    try {
      const fixture = await nativeCodexFixture(directory);
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const address = server.address();
      assert.ok(address && typeof address !== 'string');
      // The test's PID stays alive and the port is occupied; neither alone proves fixture ownership.
      await writeFile(fixture.lifecycle, JSON.stringify({ event: 'spawn', pid: process.pid, port: address.port, identity: 'owned-fixture' }) + '\n');
      // At the deadline, either the loop or its last socket probe can expire first.
      if (mode !== 'reused') await assert.rejects(fixture.waitForExit(), { code: 'NATIVE_CLEANUP_UNCONFIRMED' });
      else await fixture.waitForExit();
      for (const socket of sockets) socket.destroy();
      await close(server);
      closed = true;
      await fixture.waitForExit();
    } finally {
      for (const socket of sockets) socket.destroy();
      if (!closed) await close(server);
      await rm(directory, { recursive: true, force: true });
    }
  });
}
