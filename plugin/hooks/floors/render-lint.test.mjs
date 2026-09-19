// Unit tests for the render floor's pure parts. No browser, no server: the
// runner is exercised only as far as its fail-open skips.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routesFromArch, primaryFontFamily, fontFamilyViolation, renderAvailable, renderEnabled, routeFileName, renderChecks } from './render-lint.mjs';

const ARCH = `## UI

### Screen: Dashboard
- **module:** web
- **route:** /
- **defined-in:** gspec/features/dash/arch.md

### Screen: Settings
- **module:** web
- **route:** \`/settings\`

### Screen: Detail
- **module:** web
- **route:** /items/:id

### Screen: Modal
- **module:** web
- **defined-in:** gspec/features/dash/arch.md

### Component: Sidebar
- **module:** web
- **route:** /never-a-screen
`;

test('routes come from route: lines on Screen blocks only, absolute and concrete', () => {
  assert.deepEqual(routesFromArch(ARCH), ['/', '/settings']);
});

test('no UI section, no routes', () => {
  assert.deepEqual(routesFromArch('## Data\n\n### Entity: X\n- **module:** api\n'), []);
});

test('the primary family is the first entry of the sans token, unquoted', () => {
  assert.equal(primaryFontFamily(':root { --font-family-sans: "Geist", ui-sans-serif, system-ui; }'), 'Geist');
  assert.equal(primaryFontFamily(':root{--font-sans:Inter,sans-serif}'), 'Inter');
  assert.equal(primaryFontFamily(':root { --color-bg: #fff; }'), null);
});

test('the font assertion: Times fails, Geist passes, case is ignored', () => {
  assert.match(fontFamilyViolation('Times', 'Geist'), /starts with "Times", not the style guide's "Geist"/);
  assert.match(fontFamilyViolation('"Times New Roman", serif', 'Geist', 'html'), /rendered <html>/);
  assert.equal(fontFamilyViolation('Geist, ui-sans-serif, system-ui', 'Geist'), null);
  assert.equal(fontFamilyViolation('"geist", sans-serif', 'Geist'), null);
  assert.equal(fontFamilyViolation('anything', null), null, 'no token, no assertion');
});

test('availability needs Playwright and a dev/start script', () => {
  assert.deepEqual(renderAvailable(JSON.stringify({ devDependencies: { playwright: '1' }, scripts: { dev: 'vite' } })), { playwright: true, script: 'dev' });
  assert.deepEqual(renderAvailable(JSON.stringify({ dependencies: { '@playwright/test': '1' }, scripts: { start: 'node s.js' } })), { playwright: true, script: 'start' });
  assert.deepEqual(renderAvailable(JSON.stringify({ scripts: { dev: 'x' } })), { playwright: false, script: 'dev' });
  assert.deepEqual(renderAvailable('not json'), { playwright: false, script: null });
});

test('the switch is off when Playwright is absent, and can be forced off', () => {
  assert.equal(renderEnabled({ available: { playwright: false }, env: {} }), false);
  assert.equal(renderEnabled({ available: { playwright: true }, env: {} }), true);
  assert.equal(renderEnabled({ available: { playwright: true }, env: { GSPEC_RENDER: '0' } }), false);
  assert.equal(renderEnabled({ available: { playwright: true }, env: {}, config: { render: false } }), false);
});

test('route file names are safe', () => {
  assert.equal(routeFileName('/'), 'index.png');
  assert.equal(routeFileName('/a/b-c'), 'a__b-c.png');
});

test('the runner fails open — every missing precondition is a skip, never a violation', async () => {
  const noRoutes = await renderChecks('/nonexistent', [], {}, { pkgJsonText: '{}' });
  assert.deepEqual(noRoutes.violations, []);
  assert.match(noRoutes.skipped, /no route declared/);
  const noPw = await renderChecks('/nonexistent', ['/'], {}, { pkgJsonText: JSON.stringify({ scripts: { dev: 'x' } }) });
  assert.match(noPw.skipped, /playwright is not a dependency/);
  const noScript = await renderChecks('/nonexistent', ['/'], {}, { pkgJsonText: JSON.stringify({ devDependencies: { playwright: '1' } }) });
  assert.match(noScript.skipped, /no `dev` or `start` script/);
  const noModule = await renderChecks('/nonexistent', ['/'], {}, { pkgJsonText: JSON.stringify({ devDependencies: { playwright: '1' }, scripts: { dev: 'x' } }) });
  assert.match(noModule.skipped, /playwright could not be loaded/);
  assert.deepEqual(noModule.violations, []);
});

import { pickRenderRoot } from './render-lint.mjs';

test('the render root is the first candidate that can be rendered — a module dir when the root cannot', () => {
  const root = { dir: '.', pkgJsonText: null };
  const api = { dir: 'api', pkgJsonText: JSON.stringify({ scripts: { dev: 'tsx watch' } }) };
  const web = { dir: 'web', pkgJsonText: JSON.stringify({ devDependencies: { playwright: '1' }, scripts: { dev: 'vite' } }) };
  const picked = pickRenderRoot([root, api, web]);
  assert.equal(picked.dir, 'web');
  assert.equal(picked.script, 'dev');
  assert.equal(pickRenderRoot([root, api]), null);
});

import { isResourceFailure } from './render-lint.mjs';

test('a failed network fetch is the environment, not a finding; a thrown error still is', () => {
  assert.equal(isResourceFailure('Failed to load resource: net::ERR_CONNECTION_REFUSED'), true);
  assert.equal(isResourceFailure('TypeError: Failed to fetch'), true);
  assert.equal(isResourceFailure('Uncaught TypeError: Cannot read properties of undefined'), false);
  assert.equal(isResourceFailure('Warning: Each child in a list should have a unique key'), false);
});
