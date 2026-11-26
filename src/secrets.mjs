import { AsyncEntry } from '@napi-rs/keyring';

// One keychain entry per provider, all under a single service name so they
// don't collide with anything else on the machine.
const SERVICE = 'commitsmith';

export async function setApiKeySecret(provider, apiKey) {
  const entry = new AsyncEntry(SERVICE, provider);
  await entry.setPassword(apiKey);
}

/** Returns the stored key, or null if there isn't one or the OS has no reachable keychain backend (e.g. headless Linux/CI). */
export async function getApiKeySecret(provider) {
  try {
    const entry = new AsyncEntry(SERVICE, provider);
    return await entry.getPassword();
  } catch {
    return null;
  }
}

export async function deleteApiKeySecret(provider) {
  try {
    const entry = new AsyncEntry(SERVICE, provider);
    return await entry.deletePassword();
  } catch {
    return false;
  }
}
