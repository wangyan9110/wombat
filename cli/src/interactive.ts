import { t } from '@wombat/client/locale';
import { spawn } from 'node:child_process';
import { CoreError, type UsageRequest } from '@wombat/client';
import { createNodeClient } from '@wombat/client/node';

export function supportsTerminalRuntime(version: string): boolean {
  const [major, minor] = version.split('.').map(Number);
  return major > 26 || (major === 26 && minor >= 4);
}

export function terminalProcessArgs(execArgs: readonly string[], argv: readonly string[]): string[] {
  if (!argv[1]) throw new CoreError('INVALID_ARGUMENT', t("cli.interactive.wombat_entry_point_is_missing"));
  return [...execArgs.filter(arg => arg !== '--experimental-ffi' && arg !== '--no-experimental-ffi'), '--experimental-ffi', ...argv.slice(1)];
}

// FFI is enabled only for the interactive process, before loading OpenTUI.
export async function launchInteractive(request: UsageRequest): Promise<number> {
  if (!supportsTerminalRuntime(process.versions.node)) {
    throw new CoreError('UNSUPPORTED_RUNTIME', t("cli.interactive.the_terminal_ui_requires_node_js"));
  }
  if (!process.execArgv.includes('--experimental-ffi')) {
    const child = spawn(process.execPath, terminalProcessArgs(process.execArgv, process.argv), { stdio: 'inherit' });
    const signals = ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGWINCH'] as const;
    const handlers = signals.map(signal => () => { child.kill(signal); });
    for (const [index, signal] of signals.entries()) process.on(signal, handlers[index]);
    try {
      return await new Promise<number>((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', (code, signal) => resolve(code ?? (signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : signal === 'SIGHUP' ? 129 : 1)));
      });
    } finally {
      for (const [index, signal] of signals.entries()) process.off(signal, handlers[index]);
    }
  }
  const { startTerminalApp } = await import('@wombat/tui');
  return startTerminalApp(request, createNodeClient());
}
