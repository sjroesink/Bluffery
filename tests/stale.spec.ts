import { test, expect } from "@playwright/test";
test("a delayed old SSE resync response cannot overwrite a newer revision", async ({
  page,
  baseURL,
}) => {
  let release!: () => void, arrived!: () => void;
  const gate = new Promise<void>((r) => (release = r)),
    arrival = new Promise<void>((r) => (arrived = r));
  let held = false;
  await page.route("**/api/state", async (route) => {
    const response = await route.fetch();
    if (response.status() === 200 && !held) {
      held = true;
      arrived();
      await gate;
      await route.fulfill({ response });
    } else await route.fulfill({ response });
  });
  try {
    await page.goto("/");
    await page.getByLabel("Je naam").fill("Stale Test");
    await page.getByRole("button", { name: "Nieuwe tafel" }).click();
    await expect(page.getByTestId("room-code")).toBeVisible();
    await arrival;
    const r = await page.request.post("/api/command", {
      headers: { Origin: baseURL! },
      data: {
        id: "newer-sse-config-01",
        action: "configure",
        version: 1,
        turns: 1,
      },
    });
    expect(r.status()).toBe(200);
    await expect(page.getByLabel("Beurten per persoon")).toHaveValue("1");
    release();
    await page.evaluate(
      () =>
        new Promise<void>((r) =>
          requestAnimationFrame(() => requestAnimationFrame(() => r())),
        ),
    );
    await expect(page.getByLabel("Beurten per persoon")).toHaveValue("1");
    const s = await (await page.request.get("/api/state")).json();
    expect(s.version).toBe(2);
  } finally {
    release();
  }
});
