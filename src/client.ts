import { init } from "@immich/sdk";
import type { Config } from "./config.js";
import { applyTlsPolicy } from "./tls.js";

export function initImmichClient(config: Config): void {
  applyTlsPolicy(config);
  init({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
  });
}
