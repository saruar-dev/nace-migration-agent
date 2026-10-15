import { describe, expect, it } from "vitest";
import { resolveNdiPrice } from "../src/config.js";

describe("resolveNdiPrice", () => {
  it("prefers the argument", () => {
    expect(resolveNdiPrice(0.02, "0.5")).toBe(0.02);
  });
  it("reads the environment", () => {
    expect(resolveNdiPrice(undefined, "0.005")).toBe(0.005);
  });
  it.each(["", "  ", "abc", "0", "-1", "Infinity"])("treats %j as unset", (env) => {
    expect(resolveNdiPrice(undefined, env)).toBeNull();
  });
  it("ignores a non-positive argument", () => {
    expect(resolveNdiPrice(0, undefined)).toBeNull();
  });
});
