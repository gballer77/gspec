// The file paths a task names, in backticks — shared by the implementation
// floor (did the work land?) and the plan floor (do two [P] tasks write the
// same file?). Pure.
//
// The extension list is NOT decoration: `word.word` also matches every API
// reference a task mentions (`AbortSignal.timeout`, `res.json`), and these
// checks block, so only real source extensions count. Broad on purpose — too
// narrow and a real file is called missing.
const SOURCE_EXT = [
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'cts',
  'astro', 'vue', 'svelte', 'html', 'htm',
  'css', 'scss', 'sass', 'less', 'styl',
  'json', 'jsonc', 'yml', 'yaml', 'toml', 'ini', 'env', 'lock',
  'sql', 'prisma', 'graphql', 'gql',
  'md', 'mdx', 'txt', 'sh', 'bash', 'zsh', 'fish',
  'py', 'rb', 'go', 'rs', 'java', 'kt', 'kts', 'swift', 'php', 'cs', 'ex', 'exs',
  'dockerfile', 'conf', 'cfg', 'xml', 'svg', 'proto',
].join('|');
export const PATHISH = new RegExp('`([^`\\s]+\\.(?:' + SOURCE_EXT + '))`', 'gi');

// A bare `.js` token is a package name far more often than a repo file
// (`chart.js`, `three.js`) and a false positive here is unrecoverable.
export const looksLikePackageName = (path) => !path.includes('/') && /\.js$/i.test(path);

/** Every concrete file path named in backticks in `text` — no globs, no packages. */
export function pathsNamedBy(text) {
  const out = [];
  for (const m of String(text).matchAll(PATHISH)) {
    if (looksLikePackageName(m[1])) continue;
    if (/[*?{]/.test(m[1])) continue;
    if (!out.includes(m[1])) out.push(m[1]);
  }
  return out;
}
