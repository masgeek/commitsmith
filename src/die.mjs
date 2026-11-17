/** Fail fast with a clear message and a non-zero exit code. */
export function die(message) {
  console.error(message);
  process.exit(1);
}
