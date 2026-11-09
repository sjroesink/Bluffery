import { test, expect, chromium } from "@playwright/test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { createServer } from "node:http";
const base = process.env.E2E_BASE_URL || "http://127.0.0.1:18088";
const evidence = process.env.BLUFFERY_EVIDENCE_DIR || "test-results/evidence";
test("production PWA: installability, authenticated cache boundary, native offline refresh and reconnect", async () => {
  await mkdir(evidence, { recursive: true });
  const profile = join(evidence, "pwa-profile-" + Date.now());
  const ctx = await chromium.launchPersistentContext(profile, {
    headless: true,
    executablePath: process.env.CHROMIUM_PATH,
    args: ["--no-sandbox"],
    viewport: { width: 390, height: 844 },
  });
  try {
    const page = await ctx.newPage();
    await page.goto(base);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await expect
      .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
      .toBe(true);
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("Page.enable");
    const errors = await cdp.send("Page.getInstallabilityErrors");
    expect(errors.installabilityErrors).toEqual([]);
    await page.getByLabel("Je naam").fill("PWA Test");
    await page.getByRole("button", { name: "Nieuwe tafel" }).click();
    await expect(page.getByTestId("room-code")).toBeVisible();
    const code = await page.getByTestId("room-code").innerText();
    const state = await page.request.get(base + "/api/state");
    expect(state.headers()["cache-control"]).toBe("no-store");
    const keys = await page.evaluate(async () => {
      let keys: string[] = [];
      for (const n of await caches.keys()) {
        const c = await caches.open(n);
        keys.push(...(await c.keys()).map((r) => new URL(r.url).pathname));
      }
      return keys;
    });
    expect(keys.length).toBeGreaterThan(5);
    expect(
      keys.every((k) => !k.startsWith("/api/") && !k.includes("code=")),
    ).toBe(true);
    expect(keys).not.toContain("/sw.js");
    const sw = await page.request.get(base + "/sw.js");
    expect(sw.headers()["cache-control"]).toBe("no-cache, no-store");
    expect(sw.headers()["cloudflare-cdn-cache-control"]).toBe("no-store");
    await ctx.setOffline(true);
    await cdp.send("Network.enable");
    await cdp.send("Network.overrideNetworkState", {
      offline: true,
      latency: 0,
      downloadThroughput: 0,
      uploadThroughput: 0,
    });
    expect(await page.evaluate(() => navigator.onLine)).toBe(false);
    expect(
      await page.evaluate(() =>
        fetch("/api/state", { cache: "no-store" })
          .then(() => false)
          .catch(() => true),
      ),
    ).toBe(true);
    await page.reload();
    await expect(page.getByText("Je bent offline.")).toBeVisible();
    expect(await page.evaluate(() => navigator.onLine)).toBe(false);
    await expect(
      page.getByRole("button", { name: "Nieuwe tafel" }),
    ).toBeDisabled();
    await page.screenshot({
      path: join(evidence, "offline-mobile.png"),
      fullPage: true,
    });
    await ctx.setOffline(false);
    await cdp.send("Network.overrideNetworkState", {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });
    await expect(page.getByTestId("room-code")).toHaveText(code);
    await page.screenshot({
      path: join(evidence, "pwa-lobby.png"),
      fullPage: true,
    });
  } finally {
    await ctx.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test("real waiting worker asks consent: only consenting tab reloads (public update proxy fixture)", async ({
  browser,
}) => {
  // Disposable proxy changes only public worker bytes. Actual shell/API are from the built Go server.
  let revision = 0;
  const upstream = await (await fetch(base + "/sw.js")).text();
  const fixture = createServer(async (req, res) => {
    try {
      if (req.url === "/sw.js") {
        res.writeHead(200, {
          "Content-Type": "text/javascript",
          "Cache-Control": "no-cache, no-store",
          "Cloudflare-CDN-Cache-Control": "no-store",
          "Service-Worker-Allowed": "/",
        });
        res.end(
          upstream.replace(
            /bluffery-shell-([a-f0-9]+)/,
            "bluffery-shell-$1-test" + revision,
          ),
        );
        return;
      }
      const response = await fetch(base + req.url, { redirect: "manual" });
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      res.writeHead(502);
      res.end();
    }
  });
  await new Promise<void>((r) => fixture.listen(0, "127.0.0.1", r));
  const address = fixture.address() as any;
  const url = `http://127.0.0.1:${address.port}`;
  const ctx = await browser.newContext();
  try {
    const a = await ctx.newPage(),
      b = await ctx.newPage();
    await a.goto(url);
    await a.evaluate(() => navigator.serviceWorker.ready);
    await a.reload();
    await b.goto(url);
    await a.getByLabel("Je naam").fill("niet wissen A");
    await b.getByLabel("Je naam").fill("niet wissen B");
    await expect
      .poll(() => a.evaluate(() => !!navigator.serviceWorker.controller))
      .toBe(true);
    revision = 1;
    await a.evaluate(async () => {
      const r = await navigator.serviceWorker.getRegistration();
      await r?.update();
    });
    await expect(a.getByRole("button", { name: "Nu bijwerken" })).toBeVisible();
    await expect(b.getByRole("button", { name: "Nu bijwerken" })).toBeVisible();
    await expect(a.getByLabel("Je naam")).toHaveValue("niet wissen A");
    await expect(b.getByLabel("Je naam")).toHaveValue("niet wissen B");
    let countA = 0,
      countB = 0;
    a.on("load", () => countA++);
    b.on("load", () => countB++);
    await a.getByRole("button", { name: "Nu bijwerken" }).click();
    await expect(a.getByLabel("Je naam")).toHaveValue("");
    await expect.poll(() => countA).toBe(1);
    await expect(b.getByLabel("Je naam")).toHaveValue("niet wissen B");
    expect(countB).toBe(0);
    await expect(b.getByRole("button", { name: "Nu bijwerken" })).toHaveCount(
      0,
    );
    const caches = await b.evaluate(() => window.caches.keys());
    expect(
      caches.filter((k) => k.startsWith("bluffery-shell-")).length,
    ).toBeLessThanOrEqual(2);
  } finally {
    await ctx.close();
    await new Promise<void>((r) => fixture.close(() => r()));
  }
});
