import { cp, mkdir, rename, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const staging = fileURLToPath(new URL('../dist/.web-staging', import.meta.url));
const destination = fileURLToPath(new URL('../dist/web', import.meta.url));
await rm(staging, { recursive: true, force: true });
await mkdir(staging, { recursive: true });
await cp(new URL('../ui/dist/', import.meta.url), staging, { recursive: true });
await rm(destination, { recursive: true, force: true });
await rename(staging, destination);
