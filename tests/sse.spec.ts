import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
test("authenticated SSE updates four phones without periodic polling and resyncs after reconnect", async ({
  browser,
}) => {
  const ctx = await Promise.all([0, 1, 2, 3].map(() => browser.newContext()));
  const pages = await Promise.all(ctx.map((c) => c.newPage()));
  const events = [0, 0, 0, 0];
  const reads = [0, 0, 0, 0];
  pages.forEach((p, i) =>
    p.on("request", (r) => {
      if (new URL(r.url()).pathname === "/api/events") events[i]++;
      if (new URL(r.url()).pathname === "/api/state") reads[i]++;
    }),
  );
  try {
    await pages[0].goto("/");
    await pages[0].getByLabel("Je naam").fill("SSE Host");
    await pages[0].getByRole("button", { name: "Nieuwe tafel" }).click();
    const code = await pages[0].getByTestId("room-code").innerText();
    for (let i = 1; i < 4; i++) {
      await pages[i].goto("/?code=" + code);
      await pages[i].getByLabel("Je naam").fill("SSE " + i);
      await pages[i].getByRole("button", { name: "Doe mee" }).click();
      await expect(pages[i].getByText("Wachten op de host")).toBeVisible();
    }
    await expect.poll(() => events.every((v) => v >= 1)).toBe(true);
    await expect(pages[0].getByText("4 / 10", { exact: true })).toBeVisible();
    const initial = reads.slice();
    await new Promise((r) => setTimeout(r, 3200));
    expect(reads).toEqual(initial);
    const source = await readFile("src/main.tsx", "utf8");
    expect(source).not.toMatch(/setInterval\s*\(/);
    await pages[0].getByRole("button", { name: "Start", exact: true }).click();
    await expect(pages[1].getByText("SSE Host raadt")).toBeVisible({
      timeout: 1200,
    });
    await pages[0].getByRole("button", { name: "Uitdelen", exact: true }).click();
    for (let i = 1; i < 4; i++)
      await expect(pages[i].getByTestId("private-answer")).toBeVisible({
        timeout: 1200,
      });
    await ctx[3].setOffline(true);
    await pages[0]
      .getByRole("button", { name: /^Stop & pak/ })
      .click();
    await expect(pages[1].getByTestId("settled-answer")).toBeVisible({
      timeout: 1200,
    });
    const before = events[3];
    await ctx[3].setOffline(false);
    await expect(pages[3].getByTestId("settled-answer")).toBeVisible({
      timeout: 15000,
    });
    await expect.poll(() => events[3] > before, { timeout: 15000 }).toBe(true);
    const controller = await pages[0].evaluate(
      () => !!navigator.serviceWorker.controller,
    );
    if (controller) {
      const cached = await pages[0].evaluate(async () => {
        const urls = [];
        for (const key of await caches.keys()) {
          urls.push(
            ...(await (await caches.open(key)).keys()).map((r) => r.url),
          );
        }
        return urls;
      });
      expect(cached.some((u) => u.includes("/api/"))).toBe(false);
    }
  } finally {
    await Promise.all(ctx.map((c) => c.close()));
  }
});
