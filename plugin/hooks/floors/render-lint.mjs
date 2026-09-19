// Floor: does it render? (pure parts, plus one fail-open runner)
//
// A whole app shipped in Times New Roman through 335 tests and three QA
// passes — the font variable was set on <body> while `font-family` was set
// on <html> — and three dashboard layout defects on another run were obvious
// in a screenshot and invisible to every text check. Rendering costs seconds.
//
// So, when the project can be rendered without help — Playwright is a
// devDependency and there is a `dev` or `start` script — the implement gate
// starts the server, visits each route a feature declares, and asserts the
// cheap facts: HTTP 200, no console error, and the computed `font-family`
// on <html>/<body> starting with the family the style guide's sans token
// names. A screenshot per route lands in .gspec/build/screens/<slug>/ for
// the validator's judgment pass.
//
// Read-only and FAIL-OPEN, always: any inability to render is a logged skip,
// never a violation. Text in, messages out for the pure parts; the runner
// does the I/O and is the only thing here that touches a browser.

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createRequire } from 'node:module';

// --- pure ---------------------------------------------------------------------

// Routes a feature's arch.md declares: a `- **route:** /path` (or `path:` /
// `url:`) status line on a `### Screen:` block. Absolute paths only; a screen
// without one is not visited. There is no `Route:` line convention in the
// architecture skill, so this is the tolerant reading of what a writer would
// put there — and the floor is skipped, not failed, when nothing declares one.
export function routesFromArch(archText) {
  const lines = String(archText).split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^###\s+Screen:/.test(lines[i])) continue;
    // The block ends at the next heading, so a screen without a route never
    // borrows the next block's.
    let end = i + 1;
    while (end < lines.length && !/^#{1,6}\s/.test(lines[end])) end++;
    const block = lines.slice(i + 1, end).join('\n').replace(/[*_`]/g, '');
    const m = block.match(/^\s*[-*+]?\s*(?:route|path|url)\s*:\s*(\S+)/im);
    if (!m) continue;
    const route = m[1].trim().replace(/[.,;)]+$/, '');
    if (!route.startsWith('/')) continue;
    if (/[:<>{}]/.test(route)) continue;            // a parameterized or templated path is not visitable as written
    if (!out.includes(route)) out.push(route);
  }
  return out;
}

// The first family of the style guide's sans token. Quoted or bare, with a
// stack after it; null when the guide declares no such token.
export function primaryFontFamily(styleHtml) {
  const m = String(styleHtml).match(/--font(?:-family)?-sans\s*:\s*([^;}]+)/i);
  if (!m) return null;
  const first = m[1].split(',')[0].trim().replace(/^["']|["']$/g, '').trim();
  return first || null;
}

// A generic family or a serif fallback where the token's family was expected.
// `computed` is what the browser reports for `font-family` on <html>/<body>.
export function fontFamilyViolation(computed, expected, where = 'body') {
  if (!expected) return null;
  const first = String(computed || '').split(',')[0].trim().replace(/^["']|["']$/g, '').trim();
  if (first.toLowerCase() === expected.toLowerCase()) return null;
  return `rendered <${where}> font-family starts with "${first || '(none)'}", not the style guide's "${expected}" — the token is declared but not applied where the text is set (a generic or serif fallback is showing)`;
}

// Whether the tree can be rendered unassisted: Playwright installed and a
// script to start it. `pkgJsonText` is package.json; both answers are null
// when it cannot be read.
export function renderAvailable(pkgJsonText) {
  let pkg;
  try { pkg = JSON.parse(String(pkgJsonText || '')); } catch { return { playwright: false, script: null }; }
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const playwright = Boolean(deps.playwright || deps['@playwright/test']);
  const scripts = pkg.scripts || {};
  const script = scripts.dev ? 'dev' : scripts.start ? 'start' : null;
  return { playwright, script };
}

// The first place the app can be rendered from: `[{ dir, pkgJsonText }]` in
// priority order → the first with Playwright and a dev/start script, or null.
// A three-deployable project keeps its web app in a module dir, not the root.
export function pickRenderRoot(candidates = []) {
  for (const c of candidates) {
    const a = renderAvailable(c.pkgJsonText);
    if (a.playwright && a.script) return { ...c, script: a.script };
  }
  return null;
}

// The switch: on by default when Playwright is present; off with
// `render: false` in .gspec/config.json or GSPEC_RENDER=0.
export function renderEnabled({ config = {}, env = process.env, available = { playwright: false } } = {}) {
  if (String(env.GSPEC_RENDER || '').trim() === '0' || /^(off|false|no)$/i.test(String(env.GSPEC_RENDER || ''))) return false;
  if (config.render === false) return false;
  return Boolean(available.playwright);
}

// Console errors that describe a failed network fetch rather than a defect
// in the page: the floor starts the web module alone, so anything it calls
// is down by construction.
export function isResourceFailure(text) {
  return /Failed to load resource|net::ERR_|ERR_CONNECTION_REFUSED|NetworkError|Failed to fetch|ECONNREFUSED/i.test(String(text));
}

// A route as a file name: `/` → index, `/a/b` → a__b.
export const routeFileName = (route) => (route === '/' ? 'index' : route.replace(/^\//, '').replace(/[^a-z0-9._-]+/gi, '__')) + '.png';

// --- the runner (I/O, fail-open) -------------------------------------------------

function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

async function waitFor(url, timeoutMs, fetchFn) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try { const r = await fetchFn(url); if (r.status < 500) return true; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

/**
 * Render each route and return `{ violations, screens, skipped }`.
 * `expectations.fontFamily` is the family <html>/<body> must start with.
 * `opts.screensDir` receives one PNG per route. Everything that can go wrong
 * short of a real finding — no Playwright, no browser, a server that never
 * comes up — is a `skipped` reason with no violations.
 */
export async function renderChecks(cwd, routes = [], expectations = {}, opts = {}) {
  const { screensDir = null, startTimeoutMs = 60_000, pageTimeoutMs = 20_000, pkgJsonText = null, fetchFn = globalThis.fetch, spawnFn = spawn } = opts;
  const skip = (why) => ({ violations: [], screens: [], skipped: why });
  if (!routes.length) return skip('no route declared (no `- **route:**` line on a `### Screen:` block)');
  const avail = renderAvailable(pkgJsonText);
  if (!avail.playwright) return skip('playwright is not a dependency of this project');
  if (!avail.script) return skip('no `dev` or `start` script to serve the app');
  if (typeof fetchFn !== 'function') return skip('no fetch available to probe the server');

  let pw;
  try { pw = createRequire(join(cwd, 'package.json'))('playwright'); }
  catch (e) { return skip(`playwright could not be loaded from the project (${e?.message || e})`); }

  let port;
  try { port = await freePort(); } catch { return skip('no free port'); }
  const base = `http://127.0.0.1:${port}`;
  // PORT in the environment is the widely-honored signal; `--port` covers the
  // dev servers that read only their flags. A server that ignores both still
  // announces its URL, which is sniffed below.
  const server = spawnFn('npm', ['run', avail.script, '--', '--port', String(port)], {
    cwd, env: { ...process.env, PORT: String(port), CI: '1', BROWSER: 'none' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
  });
  let announced = null;
  const sniff = (d) => { const m = String(d).match(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):\d+/); if (m && !announced) announced = m[0].replace('0.0.0.0', '127.0.0.1').replace('localhost', '127.0.0.1'); };
  server.stdout?.on('data', sniff); server.stderr?.on('data', sniff);
  const stop = () => { try { process.kill(-server.pid, 'SIGTERM'); } catch { try { server.kill('SIGTERM'); } catch { /* gone */ } } };

  try {
    // Vite binds `localhost`, which Node resolves to ::1 first; a probe on
    // 127.0.0.1 alone waited the full timeout on a server that was up. Try
    // every loopback spelling, then whatever the server announced.
    const spellings = [base, `http://localhost:${port}`, `http://[::1]:${port}`];
    let origin = null;
    const until = Date.now() + startTimeoutMs;
    while (!origin && Date.now() < until) {
      for (const u of spellings) if (await waitFor(u, 1, fetchFn)) { origin = u; break; }
      if (!origin) await new Promise((r) => setTimeout(r, 500));
    }
    if (!origin && announced && await waitFor(announced, 5_000, fetchFn)) origin = announced;
    if (!origin) return skip(`the ${avail.script} server did not answer within ${Math.round(startTimeoutMs / 1000)}s`);

    let browser;
    try { browser = await pw.chromium.launch({ headless: true }); }
    catch (e) { return skip(`chromium could not launch (${String(e?.message || e).split('\n')[0]}) — run \`npx playwright install chromium\``); }
    const violations = [];
    const screens = [];
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      for (const route of routes) {
        const errors = [];
        // A resource that failed to LOAD is the environment talking — the web
        // app calling an API the floor did not start (ERR_CONNECTION_REFUSED),
        // a favicon, a font the sandbox lacks. Only errors the page's own code
        // raised are findings.
        const onConsole = (msg) => { if (msg.type() === 'error' && !isResourceFailure(msg.text())) errors.push(msg.text()); };
        const onPageError = (e) => errors.push(String(e?.message || e));
        page.on('console', onConsole); page.on('pageerror', onPageError);
        let res = null;
        try { res = await page.goto(`${origin}${route}`, { waitUntil: 'networkidle', timeout: pageTimeoutMs }); }
        catch (e) { violations.push(`render ${route}: did not load (${String(e?.message || e).split('\n')[0]})`); page.off('console', onConsole); page.off('pageerror', onPageError); continue; }
        const status = res ? res.status() : null;
        if (status !== null && status !== 200) violations.push(`render ${route}: HTTP ${status}, expected 200`);
        if (errors.length) violations.push(`render ${route}: ${errors.length === 1 ? 'a console error' : `${errors.length} console errors`} — ${errors[0].slice(0, 160)}`);
        if (expectations.fontFamily) {
          const fonts = await page.evaluate(() => ({ html: getComputedStyle(document.documentElement).fontFamily, body: getComputedStyle(document.body).fontFamily }));
          const v = fontFamilyViolation(fonts.body, expectations.fontFamily, 'body') || fontFamilyViolation(fonts.html, expectations.fontFamily, 'html');
          if (v) violations.push(`render ${route}: ${v}`);
        }
        if (screensDir) {
          try {
            await mkdir(screensDir, { recursive: true });
            const file = join(screensDir, routeFileName(route));
            await page.screenshot({ path: file, fullPage: true });
            screens.push(file);
          } catch { /* a missing screenshot is not a finding */ }
        }
        page.off('console', onConsole); page.off('pageerror', onPageError);
      }
    } finally {
      await browser.close().catch(() => {});
    }
    return { violations, screens, skipped: null };
  } catch (e) {
    return skip(`render check errored (${String(e?.message || e).split('\n')[0]})`);
  } finally {
    stop();
  }
}
