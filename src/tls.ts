import { readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { Readable } from "node:stream";
import { rootCertificates } from "node:tls";
import { defaults } from "@immich/sdk";
import type { Config } from "./config.js";

/**
 * TLS policy for the Immich client.
 *
 * Certificate verification stays ON by default and is never changed
 * process-wide. When a CA bundle (IMMICH_CA_CERT) or the explicit opt-out
 * (IMMICH_VERIFY_SSL=false) is configured, the Immich SDK is given its own
 * `fetch` that talks through a dedicated `https.Agent`. Nothing else in the
 * process (other fetch callers, other TLS clients) is affected, and
 * NODE_TLS_REJECT_UNAUTHORIZED is never written.
 */

export interface TlsAgentOptions {
  rejectUnauthorized: boolean;
  ca?: string[];
}

export interface TlsDeps {
  readFile: (path: string) => string;
  createAgent: (options: TlsAgentOptions) => https.Agent;
  warn: (message: string) => void;
  setFetch: (fetchImpl: typeof fetch) => void;
}

let warnedInsecure = false;

/** Test hook: re-arm the one-time insecure warning. */
export function resetTlsWarning(): void {
  warnedInsecure = false;
}

const defaultDeps: TlsDeps = {
  readFile: (path) => readFileSync(path, "utf8"),
  createAgent: (options) => new https.Agent(options),
  warn: (message) => console.error(message),
  setFetch: (fetchImpl) => {
    defaults.fetch = fetchImpl;
  },
};

/**
 * Compute the agent options for a config, or undefined when the default
 * (system trust store, verification on) applies and no custom fetch is needed.
 */
export function resolveTlsOptions(
  config: Pick<Config, "verifySsl" | "caCertPath">,
  deps: Pick<TlsDeps, "readFile" | "warn"> = defaultDeps,
): TlsAgentOptions | undefined {
  let ca: string[] | undefined;
  if (config.caCertPath) {
    let pem: string;
    try {
      pem = deps.readFile(config.caCertPath);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(`IMMICH_CA_CERT could not be read (${config.caCertPath}): ${reason}`);
    }
    if (!pem.includes("-----BEGIN CERTIFICATE-----")) {
      throw new Error(`IMMICH_CA_CERT does not contain a PEM certificate: ${config.caCertPath}`);
    }
    // Node replaces the default roots when `ca` is set, so keep them and add the
    // configured bundle. Public CAs keep working alongside the private one.
    ca = [...rootCertificates, pem];
  }

  if (!config.verifySsl) {
    if (!warnedInsecure) {
      warnedInsecure = true;
      deps.warn(
        "immich-mcp: IMMICH_VERIFY_SSL=false, TLS certificate verification is disabled for Immich requests only. " +
          "Set IMMICH_CA_CERT to a PEM file to verify a self-signed server instead.",
      );
    }
    return { rejectUnauthorized: false, ...(ca ? { ca } : {}) };
  }

  return ca ? { rejectUnauthorized: true, ca } : undefined;
}

/**
 * Build a fetch implementation bound to one https.Agent. Plain http URLs use the
 * default http agent. Redirects are returned to the caller rather than followed.
 */
export function createScopedFetch(
  agent: https.Agent,
  requestImpl: { http: typeof http.request; https: typeof https.request } = {
    http: http.request,
    https: https.request,
  },
): typeof fetch {
  return async (input, init) => {
    const request = new Request(input as RequestInfo, init);
    const url = new URL(request.url);
    const isHttps = url.protocol === "https:";
    const body = request.body === null ? undefined : Buffer.from(await request.arrayBuffer());

    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      headers[key] = value;
    });
    if (body && headers["content-length"] === undefined) {
      headers["content-length"] = String(body.length);
    }

    return new Promise<Response>((resolve, reject) => {
      const req = (isHttps ? requestImpl.https : requestImpl.http)(
        url,
        {
          method: request.method,
          headers,
          signal: request.signal,
          ...(isHttps ? { agent } : {}),
        },
        (res) => {
          const responseHeaders = new Headers();
          for (const [key, value] of Object.entries(res.headers)) {
            if (Array.isArray(value)) {
              for (const v of value) responseHeaders.append(key, v);
            } else if (value !== undefined) {
              responseHeaders.set(key, value);
            }
          }
          const status = res.statusCode ?? 0;
          const nullBody = status === 204 || status === 205 || status === 304 || request.method === "HEAD";
          resolve(
            new Response(nullBody ? null : (Readable.toWeb(res) as ReadableStream), {
              status,
              statusText: res.statusMessage ?? "",
              headers: responseHeaders,
            }),
          );
        },
      );
      req.on("error", reject);
      req.end(body);
    });
  };
}

/**
 * Apply the TLS policy to the Immich SDK. The default configuration leaves the
 * SDK untouched. Returns true when a scoped fetch was installed.
 */
export function applyTlsPolicy(
  config: Pick<Config, "verifySsl" | "caCertPath">,
  deps: TlsDeps = defaultDeps,
): boolean {
  const options = resolveTlsOptions(config, deps);
  if (!options) return false;
  deps.setFetch(createScopedFetch(deps.createAgent(options)));
  return true;
}
