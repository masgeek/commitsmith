import { execFileSync } from 'node:child_process';

const CANDIDATES = {
  win32: [
    [
      'powershell',
      [
        '-NoProfile',
        '-Command',
        '[Console]::InputEncoding=[Text.Encoding]::UTF8; Set-Clipboard -Value ([Console]::In.ReadToEnd())',
      ],
    ],
  ],
  darwin: [['pbcopy', []]],
  linux: [
    ['wl-copy', []],
    ['xclip', ['-selection', 'clipboard']],
    ['xsel', ['--clipboard', '--input']],
  ],
};

/** Copies text to the system clipboard. Returns true on success, false when no clipboard tool worked. */
export function copyToClipboard(text) {
  for (const [cmd, args] of CANDIDATES[process.platform] ?? CANDIDATES.linux) {
    try {
      execFileSync(cmd, args, { input: text, stdio: ['pipe', 'ignore', 'ignore'] });
      return true;
    } catch {
      // try the next candidate
    }
  }
  return false;
}
