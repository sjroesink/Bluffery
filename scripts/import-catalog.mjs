import { readFile, mkdtemp, writeFile, rename, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
const args = process.argv.slice(2);
if (!args[0] || args.some((a, i) => i > 0 && a !== "--write"))
  throw Error("Usage: node scripts/import-catalog.mjs vetted.json [--write]");
const input = JSON.parse(await readFile(resolve(args[0]), "utf8"));
if (!Array.isArray(input.questions) || input.questions.length === 0)
  throw Error("Non-empty reviewed catalog required");
for (const q of input.questions) {
  if (!Object.hasOwn(q, "id")) {
    if (
      typeof q.question !== "string" ||
      typeof q.sources?.[0]?.url !== "string"
    )
      throw Error("Question and first source URL required");
    q.id =
      "q_" +
      createHash("sha256")
        .update(q.question + "\n" + q.sources[0].url)
        .digest("hex")
        .slice(0, 24);
  }
}
input.questions.sort((a, b) => a.id.localeCompare(b.id));
const canonical = JSON.stringify(input, null, 2) + "\n";
const dir = await mkdtemp(join(tmpdir(), "vissig-import-"));
try {
  const candidate = join(dir, "questions.json");
  await writeFile(candidate, canonical, { mode: 0o600 });
  execFileSync(process.env.GO || "go", ["run", ".", "catalog", candidate], {
    stdio: "inherit",
  });
  if (args.includes("--write")) {
    const target = "internal/catalog/questions.nl.json";
    const staging =
      target +
      "." +
      createHash("sha256").update(dir).digest("hex").slice(0, 16) +
      ".pending";
    let created = false;
    try {
      await writeFile(staging, canonical, { mode: 0o644, flag: "wx" });
      created = true;
      await rename(staging, target);
    } catch (e) {
      if (created) await rm(staging, { force: true });
      throw e;
    }
    console.log(
      "Imported reviewed seed. Rebuild and restart to transactionally upsert SQLite catalog.",
    );
  } else
    console.log(
      "Dry run only: seed unchanged. Add --write after human source review.",
    );
} finally {
  await rm(dir, { recursive: true, force: true });
}
