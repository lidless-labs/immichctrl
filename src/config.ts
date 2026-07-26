import { fromProcessEnv, type EnvReader } from "@lidless-labs/effect-operator-kit";

export interface Config {
  baseUrl: string;
  apiKey: string;
  allowWrites: boolean;
  verifySsl: boolean;
}

/**
 * Kit `requiredString` trims values and uses `${key} is required`. Immich env
 * parsing keeps raw values (including trailing spaces) and repo-specific messages.
 */
function requiredEnvString(
  env: EnvReader,
  key: string,
  message: string,
): string {
  const raw = env.get(key);
  if (!raw) {
    throw new Error(message);
  }
  return raw;
}

/**
 * Kit `parseBooleanEnv` accepts yes/on/off, throws on invalid tokens, and treats
 * blank values as fallback. Immich only treats case-insensitive "true" or exact
 * "1" as true; any other defined value is false.
 */
function boolWithFallback(
  env: EnvReader,
  key: string,
  fallback: boolean,
): boolean {
  const raw = env.get(key);
  if (raw === undefined) {
    return fallback;
  }
  return raw.toLowerCase() === "true" || raw === "1";
}

/**
 * Normalize base URL so it always includes the `/api` path prefix.
 *
 * Immich v3 moved API endpoints under `/api/*`. Users commonly set
 * `IMMICH_BASE_URL` to just the server origin (e.g. `https://photos.example.com`)
 * without the `/api` suffix. This function appends `/api` if the URL
 * does not already end with it, so the SDK constructs correct paths like
 * `https://photos.example.com/api/search/smart` instead of
 * `https://photos.example.com/search/smart`.
 *
 * Accepts:
 *   "https://photos.example.com"         -> "https://photos.example.com/api"
 *   "https://photos.example.com/"        -> "https://photos.example.com/api"
 *   "https://photos.example.com/api"     -> "https://photos.example.com/api"
 *   "https://photos.example.com/api/"    -> "https://photos.example.com/api"
 *   "http://localhost:2283/api"           -> "http://localhost:2283/api"
 */
export function normalizeBaseUrl(raw: string): string {
  let url = raw.replace(/\/+$/, "");
  if (!url.endsWith("/api")) {
    url += "/api";
  }
  return url;
}

/**
 * Load Immich MCP config from process env. Uses kit `fromProcessEnv` for env
 * access; repo-local wrappers preserve Immich-specific messages and boolean rules.
 */
export function getConfig(): Config {
  const env = fromProcessEnv(process.env);

  const baseUrl = requiredEnvString(
    env,
    "IMMICH_BASE_URL",
    "IMMICH_BASE_URL is required (e.g. https://photos.example.com/api)",
  );

  const apiKey = requiredEnvString(env, "IMMICH_API_KEY", "IMMICH_API_KEY is required");

  return {
    baseUrl: normalizeBaseUrl(baseUrl),
    apiKey,
    allowWrites: boolWithFallback(env, "IMMICH_ALLOW_WRITES", false),
    verifySsl: boolWithFallback(env, "IMMICH_VERIFY_SSL", true),
  };
}
