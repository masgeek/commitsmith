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
