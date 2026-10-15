import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("package", () => {
  it("is renamed for nace", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(pkg.name).toBe("nace-migration-agent");
    expect(pkg.version).toBe("0.1.0");
    expect(pkg.bin).toEqual({ "nace-migration-agent": "dist/index.js" });
  });

  it("drops the optimize skill", () => {
    expect(existsSync("skills/optimize")).toBe(false);
    expect(existsSync(".agents/skills/optimize")).toBe(false);
  });
});
