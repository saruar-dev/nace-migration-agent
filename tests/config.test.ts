import { describe, expect, it } from "vitest";
import { resolveNdiPrices } from "../src/config.js";

describe("resolveNdiPrices", () => {
  it("parses per-tool prices from the environment", () => {
    expect(resolveNdiPrices(undefined, "parse=1.5, extract=4.5")).toEqual({ parse: 1.5, extract: 4.5 });
  });
  it("lets the argument win, tool by tool", () => {
    expect(resolveNdiPrices({ extract: 6 }, "parse=1.5,extract=4.5")).toEqual({ parse: 1.5, extract: 6 });
  });
  it.each(["", "  ", "abc", "0.01", "parse=0", "parse=-1", "parse=abc", "pages=1", "parse=Infinity"])("ignores %j", (env) => {
    expect(resolveNdiPrices(undefined, env)).toEqual({});
  });
  it("ignores non-positive arguments", () => {
    expect(resolveNdiPrices({ parse: 0, split: -2 }, undefined)).toEqual({});
  });
});
