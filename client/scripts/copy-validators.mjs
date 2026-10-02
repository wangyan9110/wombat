import { copyFile } from 'node:fs/promises';
for (const name of ['analysis-declaration', 'preferences-request', 'preferences-response', 'optimize-request', 'optimize-response', 'config-request', 'config-response', 'live-request', 'live-response', 'usage-request', 'usage-app', 'pricing-request', 'pricing-response']) {
  for (const extension of ['js', 'd.ts']) {
    await copyFile(new URL(`../src/generated/validate-${name}.${extension}`, import.meta.url), new URL(`../dist/generated/validate-${name}.${extension}`, import.meta.url));
  }
}
