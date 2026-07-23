// Project-local gspec config (.gspec/config.json) — install-time metadata the
// CLI consults later (e.g. `gspec build` defaults its engine to the target the
// project was installed for, instead of blindly assuming Claude).

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';

export const PROJECT_CONFIG_PATH = join('.gspec', 'config.json');

// Missing or unreadable config is not an error — older installs predate it.
export async function readProjectConfig(cwd) {
  try {
    return JSON.parse(await readFile(join(cwd, PROJECT_CONFIG_PATH), 'utf-8'));
  } catch {
    return {};
  }
}

// Shallow-merges `patch` over the existing config so unrelated keys survive.
export async function writeProjectConfig(cwd, patch) {
  const merged = { ...(await readProjectConfig(cwd)), ...patch };
  const path = join(cwd, PROJECT_CONFIG_PATH);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(merged, null, 2) + '\n', 'utf-8');
  return merged;
}
