import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
test("catalog import dry-run generates IDs, validates and leaves production seed alone", () => {
  const dir = mkdtempSync(join(tmpdir(), "vissig-catalog-"));
  try {
    const path = join(dir, "input.json");
    const q = {
      question: "LOKALE TESTVRAAG: wat is het testwoord?",
      answer: "TESTWOORD",
      aliases: [],
      category: "Test",
      explanation: "Louter testdata, geen geverifieerd feit.",
      sources: [
        {
          url: "https://example.invalid/test",
          title: "Lokale fixture",
          publisher: "Test",
          accessedAt: "2026-11-07",
          rightsNote: "Eigen fixture.",
        },
      ],
      verifiedAt: "2026-11-07",
      approved: true,
    };
    writeFileSync(path, JSON.stringify({ schemaVersion: 1, questions: [q] }));
    const before = readFileSync("internal/catalog/questions.nl.json", "utf8");
    let r = spawnSync("node", ["scripts/import-catalog.mjs", path], {
      encoding: "utf8",
    });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Validated 1 approved questions/);
    assert.equal(
      readFileSync("internal/catalog/questions.nl.json", "utf8"),
      before,
    );
    q.id = "q_bad";
    writeFileSync(path, JSON.stringify({ schemaVersion: 1, questions: [q] }));
    r = spawnSync("node", ["scripts/import-catalog.mjs", path], {
      encoding: "utf8",
    });
    assert.notEqual(r.status, 0);
    assert.equal(
      readFileSync("internal/catalog/questions.nl.json", "utf8"),
      before,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
