// Unit tests for the practices-enforcement core. Run: node --test hooks/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractEnforcementYaml,
  parseEnforcement,
  matchGlob,
  checkMaxNesting,
  checkMaxFunctionLength,
  checkFileNaming,
  evaluateFile,
} from './gspec-enforce-core.mjs';

const PRACTICES = `---
spec-version: v1
---

# Practices

Some prose.

## 11. Enforcement

Preamble text.

\`\`\`yaml
version: 1
rules:
  - id: max-nesting
    source: "§2 Code Quality"   # trailing comment ignored
    action: lint
    event: PostToolUse
    applies_to: ["*.sh"]
    severity: error
    params: { max_depth: 3 }
  - id: file-naming
    action: lint
    applies_to: ["*.sh"]
    severity: error
    params: { pattern: kebab-case }
  - id: no-secrets
    action: block
    applies_to: ["*"]
    severity: error
\`\`\`
`;

test('extractEnforcementYaml pulls the fenced block', () => {
  const yaml = extractEnforcementYaml(PRACTICES);
  assert.ok(yaml.includes('version: 1'));
  assert.ok(yaml.includes('id: max-nesting'));
  assert.ok(!yaml.includes('Preamble text'));
});

test('extractEnforcementYaml returns null with no Enforcement section', () => {
  assert.equal(extractEnforcementYaml('# Practices\n\nno block here'), null);
});

test('parseEnforcement reads version and all rules', () => {
  const p = parseEnforcement(PRACTICES);
  assert.equal(p.version, 1);
  assert.equal(p.rules.length, 3);
});

test('parseEnforcement handles quoted scalars, inline arrays and flow maps', () => {
  const [r0] = parseEnforcement(PRACTICES).rules;
  assert.equal(r0.id, 'max-nesting');
  assert.equal(r0.source, '§2 Code Quality');
  assert.deepEqual(r0.applies_to, ['*.sh']);
  assert.equal(r0.severity, 'error');
  assert.deepEqual(r0.params, { max_depth: 3 });
});

test('parseEnforcement returns null when no block present', () => {
  assert.equal(parseEnforcement('# Practices\n\nnothing'), null);
});

test('matchGlob: bare pattern matches basename, path pattern matches full path', () => {
  assert.equal(matchGlob('scripts/build.sh', ['*.sh']), true);
  assert.equal(matchGlob('scripts/build.js', ['*.sh']), false);
  assert.equal(matchGlob('skills/foo/bar.md', ['skills/**']), true);
  assert.equal(matchGlob('other/foo.md', ['skills/**']), false);
});

test('checkMaxNesting flags depth over max, passes at/under max', () => {
  const deep = `
if a; then
  for x in y; do
    while z; do
      case $q in
        p) echo too deep ;;
      esac
    done
  done
fi
`;
  const r = checkMaxNesting(deep, 3);
  assert.ok(r && r.depth === 4);
  assert.equal(checkMaxNesting(deep, 4), null);
});

test('checkMaxNesting: single-line if does not accumulate', () => {
  const src = 'if foo; then bar; fi\nif baz; then qux; fi\n';
  assert.equal(checkMaxNesting(src, 3), null);
});

test('checkMaxNesting: "if" inside a comment or word is not counted', () => {
  const src = '# if this were real it would nest\nnotify_user() { echo hi; }\n';
  assert.equal(checkMaxNesting(src, 3), null);
});

test('checkMaxFunctionLength flags a long function only', () => {
  const body = Array.from({ length: 45 }, (_, i) => `  echo ${i}`).join('\n');
  const src = `short() {\n  echo hi\n}\n\nlong() {\n${body}\n}\n`;
  const found = checkMaxFunctionLength(src, 40);
  assert.equal(found.length, 1);
  assert.equal(found[0].name, 'long');
  assert.ok(found[0].length > 40);
});

test('checkFileNaming: kebab-case', () => {
  assert.equal(checkFileNaming('gspec-enforce-core.mjs', 'kebab-case'), true);
  assert.equal(checkFileNaming('foo.test.sh', 'kebab-case'), true);
  assert.equal(checkFileNaming('MyScript.sh', 'kebab-case'), false);
  assert.equal(checkFileNaming('snake_case.sh', 'kebab-case'), false);
  assert.equal(checkFileNaming('anything.md', 'unknown-pattern'), true);
});

test('evaluateFile: bad filename + nesting both flagged for a .sh', () => {
  const rules = parseEnforcement(PRACTICES).rules;
  const source = 'if a; then\n  for b in c; do\n    while d; do\n      case $e in\n        f) echo x ;;\n      esac\n    done\n  done\nfi\n';
  const findings = evaluateFile({ rel: 'scripts/Bad_Name.sh', source, rules });
  const ids = findings.map((f) => f.ruleId).sort();
  assert.deepEqual(ids, ['file-naming', 'max-nesting']);
  assert.ok(findings.every((f) => f.severity === 'error'));
});

test('evaluateFile: clean kebab .sh yields no findings', () => {
  const rules = parseEnforcement(PRACTICES).rules;
  const findings = evaluateFile({ rel: 'scripts/good-name.sh', source: 'echo hi\n', rules });
  assert.deepEqual(findings, []);
});

test('evaluateFile: non-shell file skips shell-only checks', () => {
  const rules = parseEnforcement(PRACTICES).rules;
  // deeply-nested-looking JS should not trip the shell nesting check
  const findings = evaluateFile({ rel: 'src/good-name.js', source: 'if(a){if(b){if(c){if(d){}}}}', rules });
  assert.deepEqual(findings, []);
});

test('evaluateFile: block/format/unknown actions are not run by the checker', () => {
  const rules = [{ id: 'no-secrets', action: 'block', applies_to: ['*'], severity: 'error' }];
  assert.deepEqual(evaluateFile({ rel: 'anything.sh', source: 'x', rules }), []);
});
