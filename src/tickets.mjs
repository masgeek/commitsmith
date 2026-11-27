/** Jira/Linear-style keys such as ABC-123 (uppercase, so "feat-2" or "login-2" are never mistaken for tickets). */
export const DEFAULT_TICKET_PATTERN = '\\b[A-Z][A-Z0-9]+-\\d+\\b';

/**
 * Pulls a ticket reference out of a branch name.
 *  - With `pattern` (a regex source from config): its first capture group, else the whole match.
 *  - Otherwise: a Jira-style key (`feature/ABC-123-login` → ABC-123), else a GitHub issue
 *    number at the start of a segment (`feat/123-login`, `issue-123`, `gh-123` → #123).
 * Returns null when there is none (or when the configured pattern isn't a valid regex).
 */
export function extractTicket(branch, { pattern = '' } = {}) {
  const name = String(branch ?? '');
  if (!name) return null;

  if (pattern) {
    try {
      const m = name.match(new RegExp(pattern));
      return m ? (m[1] ?? m[0]) : null;
    } catch {
      return null;
    }
  }

  const key = name.match(new RegExp(DEFAULT_TICKET_PATTERN));
  if (key) return key[0];
  const issue = name.match(/(?:^|\/)(?:issue-|gh-)?(\d{1,7})(?=[-_/]|$)/i);
  return issue ? `#${issue[1]}` : null;
}

const FOOTER_LINE = /^(?:BREAKING[ -]CHANGE|[A-Za-z][A-Za-z-]*): \S/;

/**
 * Appends a footer line to a commit message. If the message already ends with
 * a footer block (e.g. "BREAKING CHANGE: …") the line joins it, so the footers
 * stay contiguous; otherwise it becomes its own paragraph.
 */
export function appendFooter(message, line) {
  const text = String(message).replace(/\s+$/, '');
  const paragraphs = text.split(/\n\s*\n/);
  const last = paragraphs[paragraphs.length - 1];
  return paragraphs.length > 1 && FOOTER_LINE.test(last) ? `${text}\n${line}` : `${text}\n\n${line}`;
}

/** Adds "Refs: ABC-123" (the footer word is configurable) unless the message already mentions the ticket. */
export function withTicketFooter(message, ticket, footer = 'Refs') {
  if (!ticket) return message;
  const escaped = ticket.replace(/[.*+?^${}()|[\]\\#]/g, '\\$&');
  const mentioned = new RegExp(`(?:^|[^A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, 'i');
  return mentioned.test(message) ? message : appendFooter(message, `${footer}: ${ticket}`);
}
