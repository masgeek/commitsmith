import path from 'node:path';

/**
 * Detects likely secrets in diffs and prompts so they are not sent to a model.
 * Everything here is pattern-based and offline: it catches well-known token
 * formats, private keys, credential-looking assignments and sensitive files —
 * not every possible secret, so treat it as a safety net, not a guarantee.
 */

/** Single-line patterns; `group` means only capture group 1 (the value) is the secret. */
const PATTERNS = [
  { type: 'AWS access key', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { type: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g },
  { type: 'GitHub fine-grained token', re: /\bgithub_pat_[A-Za-z0-9_]{22,}\b/g },
  { type: 'Slack token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g },
  { type: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { type: 'Anthropic API key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
  { type: 'OpenAI API key', re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/g },
  { type: 'Stripe live key', re: /\b[sr]k_live_[0-9a-zA-Z]{20,}\b/g },
  { type: 'JWT', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  { type: 'private key', re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/g },
  {
    type: 'credential assignment',
    re: /\b(?:password|passwd|pwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|private[_-]?key)\b["']?\s*[:=]\s*["']([^"'\s]{8,})["']/gi,
    group: true,
  },
];

/** Whole private-key blocks (BEGIN…END), redacted as one unit. */
const PRIVATE_KEY_BLOCK = /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY(?: BLOCK)?-----|$)/g;

const PLACEHOLDER = /^(?:x{3,}|\*+|\.{3,}|<.+>|\$\{.+\}|\{\{.+\}\}|%.+%|(?:your|example|sample|changeme|change_me|placeholder|dummy|fake|todo|redacted).*|none|null|undefined|test|true|false)$/i;

/** A credential-assignment value worth flagging: not an obvious placeholder, and not trivially simple. */
export function looksLikeRealSecret(value) {
  if (PLACEHOLDER.test(value)) return false;
  return /\d/.test(value) || value.length >= 12;
}

const SENSITIVE_NAMES = /^(?:id_(?:rsa|dsa|ecdsa|ed25519)|\.netrc|\.pgpass)$/;
const SENSITIVE_EXTENSIONS = new Set(['.pem', '.key', '.p12', '.pfx', '.jks', '.keystore']);
const ENV_TEMPLATE = /^\.env\.(?:example|sample|template|dist|defaults?)$/i;

/** Files whose contents should never be sent: .env files (not templates), key stores, SSH keys. */
export function isSensitivePath(file) {
  const base = path.posix.basename(String(file).replace(/\\/g, '/'));
  if (ENV_TEMPLATE.test(base)) return false;
  if (/^\.env(?:\..+)?$/i.test(base)) return true;
  return SENSITIVE_NAMES.test(base) || SENSITIVE_EXTENSIONS.has(path.posix.extname(base).toLowerCase());
}

const sample = (value) => (value.length <= 4 ? '****' : `${value.slice(0, 4)}…(${value.length} chars)`);

/** Findings on one line of text: [{ type, sample }]. The sample never contains the full secret. */
export function scanLine(line) {
  const found = [];
  for (const { type, re, group } of PATTERNS) {
    for (const m of line.matchAll(re)) {
      const value = group ? m[1] : m[0];
      if (group && !looksLikeRealSecret(value)) continue;
      found.push({ type, sample: type === 'private key' ? '' : sample(value) });
    }
  }
  return found;
}

/**
 * Scans the added lines of a unified diff. Returns [{ file, line, type, sample }]
 * (`line` is the line number in the new file; 0 for a whole sensitive file).
 */
export function scanDiff(diffText) {
  const findings = [];
  let file = '';
  let line = 0;
  for (const raw of String(diffText).split('\n')) {
    const header = raw.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (header) {
      file = header[2];
      line = 0;
      if (isSensitivePath(file)) findings.push({ file, line: 0, type: 'sensitive file', sample: '' });
      continue;
    }
    const hunk = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
    if (hunk) {
      line = Number(hunk[1]) - 1;
      continue;
    }
    if (raw.startsWith('+++') || raw.startsWith('---')) continue;
    if (raw.startsWith('+')) {
      line++;
      for (const f of scanLine(raw.slice(1))) findings.push({ file, line, ...f });
    } else if (raw.startsWith(' ')) {
      line++;
    }
  }
  return findings;
}

/**
 * Replaces secrets in `text` (a prompt containing diffs) with [REDACTED:…]:
 * whole private-key blocks, known token formats, credential assignments, and
 * the full contents of sensitive files. Returns { text, findings: [{ type, count }] }.
 */
export function redactText(text) {
  const counts = new Map();
  const note = (type) => counts.set(type, (counts.get(type) ?? 0) + 1);

  let out = String(text).replace(PRIVATE_KEY_BLOCK, () => {
    note('private key');
    return '[REDACTED:private key]';
  });

  const [head, ...fileChunks] = out.split(/(?=^diff --git )/m);
  const redactPatterns = (chunk) => {
    let result = chunk;
    for (const { type, re, group } of PATTERNS) {
      if (type === 'private key') continue; // blocks handled above
      result = result.replace(re, (match, value) => {
        if (!group) {
          note(type);
          return `[REDACTED:${type}]`;
        }
        if (!looksLikeRealSecret(value)) return match;
        note(type);
        const at = match.lastIndexOf(value);
        return `${match.slice(0, at)}[REDACTED:${type}]${match.slice(at + value.length)}`;
      });
    }
    return result;
  };

  out = [
    redactPatterns(head),
    ...fileChunks.map((chunk) => {
      const header = chunk.match(/^diff --git a\/(.+?) b\/(.+)$/m);
      if (header && isSensitivePath(header[2])) {
        note('sensitive file');
        return `${chunk.split('\n')[0]}\n[contents of sensitive file omitted]\n`;
      }
      return redactPatterns(chunk);
    }),
  ].join('');

  return { text: out, findings: [...counts].map(([type, count]) => ({ type, count })) };
}

const summarize = (findings) => findings.map((f) => `${f.count}× ${f.type}`).join(', ');

const warned = new Set();

/**
 * Applies the guard to a prompt before it leaves the machine.
 *  mode "redact" (default): replace secrets and warn once on stderr;
 *  mode "block": refuse (throws) when anything is found;
 *  mode "off": untouched.
 * Returns { prompt, findings }.
 */
export function guardPrompt(prompt, mode = 'redact') {
  if (mode === 'off') return { prompt, findings: [] };
  const { text, findings } = redactText(prompt);
  if (findings.length === 0) return { prompt, findings };

  if (mode === 'block') {
    throw new Error(
      `Refusing to send this to the model: it contains likely secrets (${summarize(findings)}). ` +
        'Remove them, or set COMMITSMITH_SECRET_GUARD=redact (or off) to continue.'
    );
  }

  const key = summarize(findings);
  if (!warned.has(key)) {
    warned.add(key);
    console.error(`⚠ Redacted likely secrets from what is sent to the model (${key}). They are still in your changes — don't commit them.`);
  }
  return { prompt: text, findings };
}
