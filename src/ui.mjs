import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import * as clack from '@clack/prompts';
import { autoYes } from './cli-args.mjs';
import { isInteractive } from './tty.mjs';
import { ALLOWED_TYPES } from './constants.mjs';
import { retypeMessage, isBreakingMessage } from './parsing.mjs';

export function printVersion() {
  const pkgPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
  const { name, version } = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  console.log(`${name} v${version}`);
}

/** Open `message` in $GIT_EDITOR/$EDITOR for editing; returns the edited text, or the original if the editor fails or leaves it empty. */
export function editMessageInEditor(message) {
  const editor = process.env.GIT_EDITOR || process.env.EDITOR || (process.platform === 'win32' ? 'notepad' : 'vi');
  const tmpFile = path.join(os.tmpdir(), `commitsmith-msg-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
  fs.writeFileSync(tmpFile, message, 'utf8');

  try {
    const result = spawnSync(`${editor} ${JSON.stringify(tmpFile)}`, { stdio: 'inherit', shell: true });
    if (result.error || result.status !== 0) {
      console.warn(`Editor "${editor}" did not exit cleanly; keeping the previous message.`);
      return message;
    }
    const edited = fs.readFileSync(tmpFile, 'utf8').replace(/\r\n/g, '\n').replace(/\n+$/, '');
    return edited.trim() ? edited : message;
  } finally {
    try {
      fs.unlinkSync(tmpFile);
    } catch {
      // best-effort cleanup
    }
  }
}

function printMessageBox(message) {
  console.log('——————————————————');
  console.log(message);
  console.log('——————————————————');
}

/**
 * Review a generated message before committing. With -y it auto-accepts;
 * without a real terminal (pipe, CI, --no-interactive) it never prompts and
 * declines, so scripts can't hang. Otherwise an interactive menu: commit, edit
 * in $EDITOR, change type/breaking flag, regenerate (optionally with an
 * instruction), or skip. `regenerate(feedback)` should return a fresh message.
 * Returns { proceed, message }.
 */
export async function confirmWithEdit(question, message, { regenerate } = {}) {
  if (autoYes) return { proceed: true, message };
  if (!isInteractive()) {
    console.warn('Non-interactive session: not committing. Pass -y to commit without confirmation.');
    return { proceed: false, message };
  }

  const prompt = question.replace(/\s*\[y\/N\/e\]\s*$/i, '').trim();
  let current = message;

  for (;;) {
    const options = [
      { value: 'yes', label: 'Commit' },
      { value: 'edit', label: 'Edit in editor' },
      { value: 'type', label: 'Change type / breaking flag' },
      ...(regenerate
        ? [
            { value: 'regen', label: 'Regenerate' },
            { value: 'regen-note', label: 'Regenerate with an instruction…' },
          ]
        : []),
      { value: 'skip', label: 'Skip' },
    ];
    const choice = await clack.select({ message: prompt, options, initialValue: 'yes' });
    if (clack.isCancel(choice) || choice === 'skip') return { proceed: false, message: current };
    if (choice === 'yes') return { proceed: true, message: current };

    if (choice === 'edit') {
      current = editMessageInEditor(current);
    } else if (choice === 'type') {
      const type = await clack.select({
        message: 'Commit type',
        options: [...ALLOWED_TYPES].map((t) => ({ value: t, label: t })),
        initialValue: current.match(/^\S+\s+(\w+)/)?.[1],
      });
      if (clack.isCancel(type)) continue;
      const breaking = await clack.confirm({ message: 'Mark as BREAKING CHANGE?', initialValue: isBreakingMessage(current) });
      if (clack.isCancel(breaking)) continue;
      let breakingReason = '';
      if (breaking && !/\n\nBREAKING CHANGE:/.test(current)) {
        const reason = await clack.text({ message: 'What breaks? (goes in the BREAKING CHANGE footer)', placeholder: 'e.g. config key maxDiff renamed to maxDiffChars' });
        if (!clack.isCancel(reason)) breakingReason = reason.trim();
      }
      current = retypeMessage(current, { type, breaking, breakingReason });
    } else {
      let feedback = '';
      if (choice === 'regen-note') {
        const note = await clack.text({ message: 'Instruction for the model', placeholder: 'e.g. mention the API change, shorter subject' });
        if (clack.isCancel(note) || !note.trim()) continue;
        feedback = note.trim();
      }
      current = await regenerate(feedback);
      continue; // generateMessage* already printed the new message
    }
    printMessageBox(current);
  }
}
