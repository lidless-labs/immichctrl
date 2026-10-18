import { realpathSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { fromProcessEnv, type EnvReader } from "@lidless-labs/effect-operator-kit";

export interface Config {
  baseUrl: string;
  apiKey: string;
  allowWrites: boolean;
  verifySsl: boolean;
  /** HTTP sessions cannot read or write host files. Undefined preserves stdio. */
  localFileAccess?: boolean;
  /** Canonical absolute upload directory, resolved at startup. Unset denies uploads. */
  uploadBaseDir?: string;
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

  const uploadRoot = env.get("IMMICH_UPLOAD_BASE_DIR");
  let uploadBaseDir: string | undefined;
  if (uploadRoot) {
    if (!isAbsolute(uploadRoot)) {
      throw new Error("IMMICH_UPLOAD_BASE_DIR must be an absolute path");
    }
    try {
      uploadBaseDir = realpathSync(uploadRoot);
      if (!statSync(uploadBaseDir).isDirectory()) throw new Error("not a directory");
    } catch {
      throw new Error("IMMICH_UPLOAD_BASE_DIR must resolve to an existing directory");
    }
  }

  return {
    baseUrl,
    apiKey,
    uploadBaseDir,
    allowWrites: boolWithFallback(env, "IMMICH_ALLOW_WRITES", false),
    verifySsl: boolWithFallback(env, "IMMICH_VERIFY_SSL", true),
  };
}
