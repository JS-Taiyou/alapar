import { describe, expect, it } from "vite-plus/test";
import { en } from "./locales/en";
import { es } from "./locales/es";

const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();

describe("translations", () => {
  it("English translates every Spanish key, and adds none of its own", () => {
    // A key missing from English falls back to Spanish inside the English UI.
    expect(Object.keys(en).sort()).toEqual(Object.keys(es).sort());
  });

  it("no translation is empty", () => {
    for (const dictionary of [es, en]) {
      for (const [key, value] of Object.entries(dictionary)) {
        expect(value.trim().length, key).toBeGreaterThan(0);
      }
    }
  });

  it("both languages fill the same placeholders", () => {
    for (const key of Object.keys(es)) {
      expect(placeholders(en[key]), key).toEqual(placeholders(es[key]));
    }
  });
});
