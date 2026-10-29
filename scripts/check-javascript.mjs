import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
let checked = 0;
let failed = false;
async function check(directory) {
  for (const entry of await readdir(path.join(root, directory), { withFileTypes: true })) {
    const relative = path.join(directory, entry.name);
    if (entry.isDirectory()) await check(relative);
    else if (/\.(?:js|mjs)$/.test(entry.name)) {
      const result = spawnSync(process.execPath, ['--check', relative], { cwd: root, stdio: 'inherit' });
      checked++;
      if (result.error) console.error(result.error.message);
      if (result.error || result.status !== 0) failed = true;
    }
  }
}

for (const directory of ['renderer', 'browser-extension', 'scripts']) await check(directory);
console.log(`JavaScript syntax: ${checked} files checked.`);
process.exitCode = failed ? 1 : 0;
