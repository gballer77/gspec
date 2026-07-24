// Interactive prompt layer for the CLI. On a TTY, prompts are arrow-key driven
// (@clack/prompts: select, multiselect, confirm, text). Off a TTY (piped input,
// CI), each prompt falls back to the classic numbered/text readline form so
// scripted usage like `echo claude | gspec` keeps working.
//
// Option shape everywhere: { value, label, hint? }. `hint` renders dim next to
// the highlighted row on a TTY and after an em-dash in the fallback listing.

import { createInterface } from 'node:readline';
import * as clack from '@clack/prompts';
import chalk from 'chalk';

const isTTY = () => Boolean(process.stdin.isTTY && process.stdout.isTTY);

// Ctrl+C / Escape inside a clack prompt returns a cancel symbol; treat it as
// the user backing out, same as answering "no" to an install confirm.
function guard(value) {
  if (clack.isCancel(value)) {
    clack.cancel('Cancelled.');
    process.exit(0);
  }
  return value;
}

function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export async function promptSelect(message, options) {
  if (isTTY()) {
    return guard(await clack.select({
      message,
      options: options.map((o) => ({ value: o.value, label: o.label, hint: o.hint || undefined })),
    }));
  }

  console.log(chalk.bold(`\n${message}\n`));
  options.forEach((o, i) => {
    const hint = o.hint ? chalk.dim(` — ${o.hint}`) : '';
    console.log(`  ${chalk.cyan(String(i + 1))}) ${o.label}${hint}`);
  });
  console.log();
  const answer = await ask(chalk.bold(`  Select [1-${options.length}]: `));
  const num = parseInt(answer, 10);
  if (num >= 1 && num <= options.length) return options[num - 1].value;
  const lowered = answer.toLowerCase();
  const byText = options.find(
    (o) => String(o.value).toLowerCase() === lowered || o.label.toLowerCase() === lowered,
  );
  if (byText) return byText.value;
  console.error(chalk.red(`\nInvalid selection: "${answer}"`));
  process.exit(1);
}

// Returns an array of selected values; an empty selection is allowed (skip).
export async function promptMultiSelect(message, options) {
  if (isTTY()) {
    return guard(await clack.multiselect({
      message: `${message} ${chalk.dim('(space to toggle, enter to submit)')}`,
      options: options.map((o) => ({ value: o.value, label: o.label, hint: o.hint || undefined })),
      required: false,
    }));
  }

  console.log(chalk.bold(`\n${message}\n`));
  options.forEach((o, i) => {
    const hint = o.hint ? chalk.dim(` — ${o.hint}`) : '';
    console.log(`  ${chalk.cyan(String(i + 1))}) ${o.label}${hint}`);
  });
  console.log();
  const answer = await ask(chalk.bold('  Enter numbers (comma-separated), "all", or press Enter to skip: '));
  const trimmed = answer.toLowerCase();
  if (trimmed === '') return [];
  if (trimmed === 'all') return options.map((o) => o.value);
  const nums = trimmed.split(',').map((s) => parseInt(s.trim(), 10));
  if (nums.some((n) => isNaN(n) || n < 1 || n > options.length)) {
    console.error(chalk.red(`\nInvalid selection: "${answer}"`));
    process.exit(1);
  }
  return nums.map((n) => options[n - 1].value);
}

// `initial` sets the default (what a bare Enter means): false → [y/N], true → [Y/n].
export async function promptConfirm(message, initial = false) {
  if (isTTY()) {
    return guard(await clack.confirm({ message, initialValue: initial }));
  }

  const suffix = initial ? '[Y/n]' : '[y/N]';
  const answer = (await ask(chalk.bold(`  ${message} ${suffix}: `))).toLowerCase();
  if (answer === '') return initial;
  return answer.startsWith('y');
}

export async function promptInput(message, { placeholder } = {}) {
  if (isTTY()) {
    const value = guard(await clack.text({ message, placeholder }));
    return (value ?? '').trim();
  }
  return ask(chalk.bold(`  ${message} `));
}
