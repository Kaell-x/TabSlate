import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

// 版本号 4 段制：前三段跟随官方版本，最后一段为本地构建递增值，用于区分官方发布。
const cfgPath = "wxt.config.ts";
let cfg = readFileSync(cfgPath, "utf8");
const m = cfg.match(/version: "(\d+)\.(\d+)\.(\d+)(?:\.(\d+))?"/);
if (!m) {
  throw new Error("version not found in wxt.config.ts");
}
const base = `${m[1]}.${m[2]}.${m[3]}`;
const last = m[4] ? Number(m[4]) + 1 : 1;
const next = `${base}.${last}`;
cfg = cfg.replace(/version: "\d+\.\d+\.\d+(?:\.\d+)?"/, `version: "${next}"`);
writeFileSync(cfgPath, cfg);
console.log(`version bumped -> ${next}`);

const build = spawnSync("bun", ["run", "build"], { stdio: "inherit" });
if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

const dest = join(homedir(), "Chrome Extension", "TabSlate");
const sync = spawnSync("rsync", ["-a", "--delete", ".output/chrome-mv3/", `${dest}/`], { stdio: "inherit" });
if (sync.status !== 0) {
  process.exit(sync.status ?? 1);
}
console.log(`delivered ${next} -> ${dest}`);
