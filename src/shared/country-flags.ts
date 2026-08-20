let regionCodesByName: ReadonlyMap<string, string> | null = null;

const COUNTRY_ALIASES = new Map([
  ["great britain", "GB"],
  ["uk", "GB"],
  ["usa", "US"],
  ["south korea", "KR"],
  ["north korea", "KP"],
  ["russia", "RU"],
  ["vietnam", "VN"],
]);

function normalizeCountry(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim()
    .toLocaleLowerCase("en");
}

function regionCodeLookup(): ReadonlyMap<string, string> {
  if (regionCodesByName !== null) {
    return regionCodesByName;
  }

  const displayNames = new Intl.DisplayNames(["en"], { type: "region" });
  const codes = new Map<string, string>(COUNTRY_ALIASES);
  for (let first = 65; first <= 90; first += 1) {
    for (let second = 65; second <= 90; second += 1) {
      const code = String.fromCharCode(first, second);
      const name = displayNames.of(code);
      if (name !== undefined && name !== code) {
        codes.set(normalizeCountry(name), code);
      }
    }
  }
  regionCodesByName = codes;
  return codes;
}

export function countryFlagEmoji(country: string | null): string | null {
  const value = country?.trim();
  if (value === undefined || value.length === 0) {
    return null;
  }

  const upper = value.toUpperCase();
  const normalized = normalizeCountry(value);
  const code =
    COUNTRY_ALIASES.get(normalized) ??
    (/^[A-Z]{2}$/.test(upper)
      ? upper
      : regionCodeLookup().get(normalized));
  if (code === undefined) {
    return null;
  }

  return String.fromCodePoint(
    ...Array.from(code, (character) => 0x1f1e6 + character.charCodeAt(0) - 65),
  );
}
