// Unit tests for the style-guide token-literals floor. Run: node --test plugin/hooks/floors/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appliesToTokenLiterals, tokenLiteralViolations } from './token-literals.mjs';

const page = (css, body = '') => `<!-- spec-version: v1 -->\n<!DOCTYPE html>\n<html><head><style>${css}</style></head><body>${body}</body></html>`;

test('governs only gspec/style.html', () => {
  assert.equal(appliesToTokenLiterals('gspec/style.html'), true);
  assert.equal(appliesToTokenLiterals('gspec/style.md'), false);
  assert.equal(appliesToTokenLiterals('gspec/design/mockup.html'), false);
  assert.equal(appliesToTokenLiterals('style.html'), false);
});

test('a token-driven guide is clean: literals in :root and theme keys, var() everywhere else', () => {
  const css = `
    :root { --color-accent: #6366f1; --color-surface: rgb(255 255 255); }
    @media (prefers-color-scheme: dark) { :root { --color-surface: #1a1d23; } }
    [data-theme="dark"] { --color-accent: hsl(239 84% 72%); }
    .button { background: var(--color-accent); color: var(--color-surface); }
    .card { border-color: color-mix(in srgb, var(--color-accent), transparent); }`;
  assert.deepEqual(tokenLiteralViolations(page(css)), []);
});

test('flags a literal color in a component rule, naming the literal and selector', () => {
  const css = `:root { --color-accent: #6366f1; }\n.button { background: #6366f1; }`;
  const out = tokenLiteralViolations(page(css));
  assert.equal(out.length, 1);
  assert.match(out[0], /"#6366f1" in ".button"/);
  assert.match(out[0], /var\(--…\)/);
});

test('flags literal colors in inline style attributes', () => {
  const out = tokenLiteralViolations(page(':root { --x: #fff; }', '<div style="color: #ff0000">bad</div>'));
  assert.equal(out.length, 1);
  assert.match(out[0], /"#ff0000" in an inline style attribute/);
});

test('a nested :root inside @media is a token block; hex in comments and text content never hits', () => {
  const css = `
    @media (max-width: 768px) { :root { --space-4: 1rem; --color-bg: #0e0f12; } }
    /* #ffffff on #1a1d23 = 15.2:1 */
    .swatch { background: var(--color-bg); }`;
  const body = '<code>#6366f1</code> and a swatch label #1a1d23';
  assert.deepEqual(tokenLiteralViolations(page(css, body)), []);
});

test('caps the report and counts the rest', () => {
  const rules = Array.from({ length: 8 }, (_, i) => `.r${i} { color: #00000${i}; }`).join('\n');
  const out = tokenLiteralViolations(page(rules));
  assert.equal(out.length, 1);
  assert.match(out[0], /and 3 more/);
});
