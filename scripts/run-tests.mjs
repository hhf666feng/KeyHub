import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));

// Keep native/backend integration and public-site probes explicit opt-ins.
export const suites = {
  unit: [
    'browser-extension/test-rebrand.mjs',
    'scripts/test-keyhub-brand.mjs',
    'scripts/test-keyhub-packaging.mjs',
    'scripts/test-keyhub-logo.mjs',
    'scripts/test-owner-lock-race.mjs',
    'scripts/test-quick-native-contract.mjs',
    'scripts/test-window-zoom.mjs',
    'scripts/test-workspace-window.mjs',
    'scripts/test-static-server.mjs',
    'scripts/test-repository-tools.mjs',
    'scripts/test-readme-media.mjs',
  ],
  ui: [
    'scripts/test-personal-ui.mjs',
    'scripts/test-inline-editor.mjs',
    'scripts/test-env-group.mjs',
    'scripts/test-passkey-discovery.mjs',
    'scripts/test-modal-backdrop.mjs',
    'scripts/test-workspace-ui.mjs',
    'scripts/test-desktop-ui.mjs',
    'scripts/test-titlebar.mjs',
    'scripts/test-autofill.mjs',
    'scripts/test-login-patterns.mjs',
    'scripts/test-github-backup-ui.mjs',
    'scripts/test-quick-panel.mjs',
    'scripts/test-agent-diagnostics.mjs',
    'scripts/test-credential-interactions.mjs',
    'scripts/test-desktop-localization.mjs',
    'scripts/test-editor-layout.mjs',
    'scripts/test-extension-ui.mjs',
    'scripts/test-readable-ui.mjs',
  ],
};

export function runScripts(files, { cwd = root, stdio = 'inherit' } = {}) {
  // Sequential browsers avoid multiplying memory usage and keep failures legible.
  for (const file of files) {
    if (stdio === 'inherit') console.log(`\n--- ${file} ---`);
    const result = spawnSync(process.execPath, [file], { cwd, stdio });
    if (result.error) {
      console.error(result.error.message);
      return 1;
    }
    if (result.status !== 0) return result.status ?? 1;
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const suite = process.argv[2];
  if (!Object.hasOwn(suites, suite)) {
    console.error(`Usage: node scripts/run-tests.mjs <${Object.keys(suites).join('|')}>`);
    process.exitCode = 1;
  } else {
    process.exitCode = runScripts(suites[suite]);
  }
}
