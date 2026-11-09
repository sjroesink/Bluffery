import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

// Typography fixture, not a gameplay/API fixture: private catalog text is read
// by the test runner only, never added to the production public bundle.
const questions = JSON.parse(
  readFileSync("internal/catalog/questions.nl.json", "utf8"),
).questions;

for (const width of [320, 390]) {
  test(`all ${questions.length} production question cards wrap naturally at ${width}px`, async ({ page }) => {
    expect(questions.length).toBeGreaterThan(200);
    expect(new Set(questions.map((q: { id: string }) => q.id)).size).toBe(questions.length);
    await page.setViewportSize({ width, height: 760 });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByLabel("Je naam")).toBeVisible();
    await page.evaluate(() => document.fonts.ready);

    // Match the question card plus the settled reveal-card/source markup.
    // Keep the real served stylesheet; do not override layout or hide overflow.
    const result = await page.evaluate((catalog) => {
      const main = document.querySelector("main")!;
      main.innerHTML = `<section class="question"><span class="chip"></span><h1></h1></section>
        <section class="reveal-card"><span></span><strong></strong>
        <p></p><details open><summary>Bronnen</summary><ul></ul></details></section>`;
      const heading = main.querySelector("h1")!;
      const answer = main.querySelector("strong")!;
      const sources = main.querySelector("ul")!;
      const failures: object[] = [];
      const visited: string[] = [];
      for (const q of catalog) {
        heading.textContent = q.question;
        main.querySelector(".chip")!.textContent = q.category;
        main.querySelector(".reveal-card > span")!.textContent = q.question;
        answer.textContent = q.answer;
        main.querySelector("p")!.textContent = q.explanation;
        sources.replaceChildren(...q.sources.map((s: { url: string; publisher: string; title: string; rightsNote: string }) => {
          const li = document.createElement("li");
          const a = document.createElement("a");
          a.href = s.url;
          a.textContent = s.publisher + " · " + s.title;
          const rights = document.createElement("span");
          rights.className = "rights";
          rights.textContent = s.rightsNote;
          li.append(a, rights);
          return li;
        }));
        window.scrollTo(0, 0);
        visited.push(q.id);
        if (document.documentElement.scrollWidth > innerWidth) {
          failures.push({ id: q.id, question: q.question, scrollWidth: document.documentElement.scrollWidth, width: innerWidth });
        }
        // Text must remain inside its own box, not merely inside the viewport.
        // Range geometry also catches clipped text; no overflow-hidden escape.
        for (const node of [heading, answer, ...sources.children]) {
          const box = node.getBoundingClientRect();
          const range = document.createRange();
          range.selectNodeContents(node);
          for (const rect of range.getClientRects()) {
            if (rect.left < box.left - 1 || rect.right > box.right + 1) {
              failures.push({ id: q.id, element: node.tagName, left: rect.left, right: rect.right, boxLeft: box.left, boxRight: box.right });
            }
          }
          for (let el: Element | null = node; el; el = el.parentElement) {
            if (["hidden", "clip"].includes(getComputedStyle(el).overflowX)) {
              failures.push({ id: q.id, clippedBy: el.tagName });
            }
          }
        }
      }
      return { visited, failures, headingFontSize: getComputedStyle(heading).fontSize };
    }, questions);
    console.log("CATALOG_WRAP", JSON.stringify({ width, visited: result.visited.length, failures: result.failures }));
    expect(result.visited).toEqual(questions.map((q: { id: string }) => q.id));
    expect(result.headingFontSize).toBe("19px");
    expect(result.failures).toEqual([]);
  });
}
