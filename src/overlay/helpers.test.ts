import { describe, expect, it } from "vitest";
import { overlayFreshnessLabel } from "./helpers.ts";

describe("overlayFreshnessLabel", () => {
  it("prioritizes a disconnected server", () => {
    expect(overlayFreshnessLabel(false, "stale")).toBe("Server reconnecting");
  });

  it("reports stale provider data while connected", () => {
    expect(overlayFreshnessLabel(true, "error")).toBe(
      "Tournament data stale",
    );
  });

  it("hides freshness status for current data", () => {
    expect(overlayFreshnessLabel(true, "ready")).toBeNull();
  });
});
