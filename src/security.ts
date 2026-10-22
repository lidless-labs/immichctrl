// Secret redaction for text that leaves the process (MCP error results, CLI stderr, fatal
// boundaries). Redaction must always see the WHOLE value: the result byte cap cuts text at an
// arbitrary byte, so redacting after the cap could leave a half-cut secret that no longer
// matches. Callers redact first, then cap.

const SECRETS = new Set<string>();

// Below this a "secret" is more likely to garble ordinary words than to protect anything.
const MIN_SECRET_LENGTH = 4;

// URL userinfo (`scheme://user:pass@host`), whether or not the value was registered. Matches
// through the LAST `@` of the authority, since a password may itself contain an `@`.
const URL_USERINFO = /\b(https?:\/\/)[^\s/?#]*@/gi;

export function registerSecret(value: string | undefined): void {
  if (value && value.length >= MIN_SECRET_LENGTH) SECRETS.add(value);
}

/** Register the API key and any userinfo embedded in the base URL, as written and decoded. */
export function registerConfigSecrets(config: { baseUrl: string; apiKey: string }): void {
  registerSecret(config.apiKey);
  let url: URL;
  try {
    url = new URL(config.baseUrl);
  } catch {
    return;
  }
  for (const part of [url.password, url.username]) {
    registerSecret(part);
    try {
      registerSecret(decodeURIComponent(part));
    } catch {
      // keep the raw form only
    }
  }
  if (url.password) registerSecret(`${url.username}:${url.password}`);
}

export function redact(text: string): string {
  let out = text;
  // Longest first, so a secret that contains another registered secret is replaced whole.
  for (const secret of [...SECRETS].sort((a, b) => b.length - a.length)) {
    out = out.split(secret).join("[REDACTED]");
  }
  return out.replace(URL_USERINFO, "$1[REDACTED]@");
}

export function _resetForTests(): void {
  SECRETS.clear();
}
