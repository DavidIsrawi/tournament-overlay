import type { Plugin } from "vite";
import { APP_VERSION } from "../src/shared/app-info.ts";
import { PROTOCOL_VERSION } from "../src/shared/contracts.ts";

export function browserBuildInfo(): Plugin {
  return {
    name: "tournament-overlay-build-info",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "app-build.json",
        source: JSON.stringify({ appVersion: APP_VERSION, protocolVersion: PROTOCOL_VERSION }),
      });
    },
  };
}
