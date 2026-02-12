#!/usr/bin/env node

import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const COMMANDS_DIR = join(ROOT, 'commands');
const DIST_DIR = join(ROOT, 'dist');

// Placeholder pattern used in generic command files
const PLACEHOLDER_RE = /<<<\w+>>>/g;

const targets = {
  claude: {
    outDir: join(DIST_DIR, 'claude'),
    transform(content) {
      return content.replace(PLACEHOLDER_RE, '$ARGUMENTS');
    },
  },
  // Future targets:
  // cursor: { outDir: join(DIST_DIR, 'cursor'), transform(content) { ... } },
  // antigravity: { outDir: join(DIST_DIR, 'antigravity'), transform(content) { ... } },
};

async function build(targetNames) {
  const files = (await readdir(COMMANDS_DIR)).filter(f => f.endsWith('.md'));

  for (const name of targetNames) {
    const target = targets[name];
    if (!target) {
      console.error(`Unknown target: ${name}`);
      process.exit(1);
    }

    await mkdir(target.outDir, { recursive: true });

    for (const file of files) {
      const content = await readFile(join(COMMANDS_DIR, file), 'utf-8');
      const transformed = target.transform(content);
      await writeFile(join(target.outDir, file), transformed, 'utf-8');
    }

    console.log(`Built ${files.length} commands → dist/${name}/`);
  }
}

// Build all targets by default, or specific ones via CLI args
const requested = process.argv.slice(2);
const targetNames = requested.length > 0 ? requested : Object.keys(targets);

build(targetNames).catch(err => {
  console.error(err);
  process.exit(1);
});
