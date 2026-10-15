import { spawnSync } from "node:child_process";
import { transformSync } from "esbuild";
import { describe, expect, it } from "vitest";
import { SCENARIOS, programFor } from "../src/tools/snippets.js";
import { TEMPLATES, getBestTemplate } from "../src/tools/templates.js";
import { NACE_TYPES } from "../src/tools/types.js";

const pythonParses = (code: string) =>
  spawnSync("python3", ["-c", "import ast,sys; ast.parse(sys.stdin.read())"], { input: code, encoding: "utf8" });
const tsParses = (code: string) => transformSync(code, { loader: "ts", format: "esm", target: "es2022" });

describe("scenarios", () => {
  it("cover every nace type once, in order", () => {
    expect(SCENARIOS.map((s) => s.type)).toEqual([...NACE_TYPES]);
  });
  it.each(SCENARIOS.map((s) => [s.type, s] as const))("%s python program parses", (_t, s) => {
    const r = pythonParses(programFor(s, "python"));
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
  });
  it.each(SCENARIOS.map((s) => [s.type, s] as const))("%s typescript program parses", (_t, s) => {
    expect(() => tsParses(programFor(s, "typescript"))).not.toThrow();
  });
  it("upload every file under a unique path, so concurrent users never share one", () => {
    for (const s of SCENARIOS.filter((x) => x.type.startsWith("ndi_"))) {
      expect(s.after.python).not.toContain("new_version");
      expect(s.after.typescript).not.toContain("new_version");
      expect(s.after.python).toContain("uuid.uuid4()");
      expect(s.after.typescript).toContain("randomUUID()");
    }
  });
  it("use nace-sdk", () => {
    for (const s of SCENARIOS) {
      expect(s.setup.python).toContain("from nace_sdk import");
      expect(s.setup.typescript).toContain('from "nace-sdk"');
    }
  });
});

describe("templates", () => {
  it("exist for every type, generator and parse extra", () => {
    expect(TEMPLATES).toHaveLength(8 * 5 + 4);
  });
  it.each(TEMPLATES.map((t) => [`${t.opportunity_type} ${t.provider} ${t.language}`, t] as const))(
    "%s before_snippet parses",
    (_name, t) => {
      if (t.language === "python") expect(pythonParses(t.before_snippet).status).toBe(0);
      else expect(() => tsParses(t.before_snippet)).not.toThrow();
    },
  );
  it("never mention ScaleDown", () => {
    expect(JSON.stringify(TEMPLATES).toLowerCase()).not.toContain("scaledown");
  });
});

describe("getBestTemplate", () => {
  it("finds an exact match", () => {
    const m = getBestTemplate("drex_choice", "anthropic", "python");
    expect(m?.exact_match).toBe(true);
    expect(m?.template.before_snippet).toContain("client.messages.create");
    expect(m?.template.after_snippet).toContain("nace.system_one");
  });
  it("falls back to openai in the same language", () => {
    const m = getBestTemplate("ndi_extract", "langchain", "python");
    expect(m?.exact_match).toBe(false);
    expect(m?.template.provider).toBe("openai");
    expect(m?.template.language).toBe("python");
  });
  it("has local-library templates for parse", () => {
    expect(getBestTemplate("ndi_parse", "pdf_text", "typescript")?.template.before_snippet).toContain("pdf-parse");
    expect(getBestTemplate("ndi_parse", "local_ocr", "python")?.template.before_snippet).toContain("pytesseract");
  });
});
