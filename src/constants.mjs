export const ALLOWED_TYPES = new Set([
  'feat', 'fix', 'docs', 'style', 'refactor', 'perf', 'test',
  'build', 'ci', 'chore', 'security', 'accessibility', 'removal',
]);

export const GITMOJI = {
  feat: '✨',
  fix: '🐛',
  docs: '📝',
  style: '🎨',
  refactor: '♻️',
  perf: '⚡',
  test: '✅',
  build: '🛠️',
  ci: '👷',
  chore: '🔧',
  security: '🔒',
  accessibility: '♿',
  removal: '🗑️',
};

export const BREAKING_GITMOJI = '💥';

/** Store/destination presets for --release-notes (character limit per locale; null = unlimited). */
export const STORE_PRESETS = {
  play: { label: 'Google Play Store', maxChars: 500 },
  'app-store': { label: 'Apple App Store', maxChars: 4000 },
  github: { label: 'GitHub Release', maxChars: null },
};
