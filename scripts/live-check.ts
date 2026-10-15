import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { SCENARIOS, programFor } from "../src/tools/snippets.js";
import type { Language } from "../src/tools/types.js";

const DIR = ".live-check";
const key = process.env.NACE_API_KEY || process.env.DREX_API_KEY;
if (!key) {
  console.error("Set NACE_API_KEY (a nace_sk_ key) before running the live check.");
  process.exit(2);
}
const env = { ...process.env, NACE_API_KEY: key };

mkdirSync(DIR, { recursive: true });
const venvPython = `${DIR}/venv/bin/python`;
if (!existsSync(venvPython)) {
  for (const [cmd, args] of [
    ["python3", ["-m", "venv", `${DIR}/venv`]],
    [venvPython, ["-m", "pip", "install", "--quiet", "nace-sdk==0.1.0"]],
  ] as const) {
    const r = spawnSync(cmd, args, { stdio: "inherit" });
    if (r.status !== 0) process.exit(r.status ?? 1);
  }
}

// Arguments are type names and/or languages; each group narrows on its own (types AND languages).
const args = process.argv.slice(2);
const languages = args.filter((a) => a === "python" || a === "typescript");
const types = args.filter((a) => !languages.includes(a));
let failed = 0;
for (const s of SCENARIOS) {
  for (const language of ["python", "typescript"] as Language[]) {
    if (types.length && !types.includes(s.type)) continue;
    if (languages.length && !languages.includes(language)) continue;
    const file = `${DIR}/${s.type}.${language === "python" ? "py" : "ts"}`;
    writeFileSync(file, programFor(s, language));
    const r =
      language === "python"
        ? spawnSync(venvPython, [file], { encoding: "utf8", env, timeout: 180_000 })
        : spawnSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", file], { encoding: "utf8", env, timeout: 180_000 });
    const ok = r.status === 0;
    if (!ok) failed++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${s.type.padEnd(13)} ${language.padEnd(10)} ${(ok ? r.stdout : r.stderr).trim().split("\n").slice(-3).join(" | ").slice(0, 300)}`);
  }
}
process.exit(failed ? 1 : 0);
