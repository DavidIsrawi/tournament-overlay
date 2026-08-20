import { describe, expect, it } from "vitest";
import { countryFlagEmoji } from "./country-flags.ts";

describe("countryFlagEmoji", () => {
  it("resolves country names and ISO region codes", () => {
    expect(countryFlagEmoji("Canada")).toBe("🇨🇦");
    expect(countryFlagEmoji("US")).toBe("🇺🇸");
    expect(countryFlagEmoji("United States")).toBe("🇺🇸");
  });

  it("supports common country aliases", () => {
    expect(countryFlagEmoji("UK")).toBe("🇬🇧");
    expect(countryFlagEmoji("South Korea")).toBe("🇰🇷");
  });

  it("omits flags for empty or unknown countries", () => {
    expect(countryFlagEmoji(null)).toBeNull();
    expect(countryFlagEmoji("")).toBeNull();
    expect(countryFlagEmoji("Atlantis")).toBeNull();
  });
});
