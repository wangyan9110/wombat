import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { nativeCodexFixture } from '../helpers/native-codex.js';

async function close(server: Server) {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

for (const owned of [false, true]) {
  test(owned ? 'lifecycle cleanup still rejects a live owned process' : 'lifecycle cleanup ignores reused PIDs and ports with a different identity', { timeout: 10_000 }, async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'wombat-native-lifecycle-'));
    const server = createServer(socket => socket.end(owned ? 'owned-fixture' : 'another-process'));
    let closed = false;
    try {
      const fixture = await nativeCodexFixture(directory);
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const address = server.address();
      assert.ok(address && typeof address !== 'string');
      // The test's PID stays alive and the port is occupied; neither alone proves fixture ownership.
      await writeFile(fixture.lifecycle, JSON.stringify({ event: 'spawn', pid: process.pid, port: address.port, identity: 'owned-fixture' }) + '\n');
      if (owned) await assert.rejects(fixture.waitForExit(), /Synthetic native processes did not exit/);
      else await fixture.waitForExit();
      await close(server);
      closed = true;
      await fixture.waitForExit();
    } finally {
      if (!closed) await close(server);
      await rm(directory, { recursive: true, force: true });
    }
  });
}
