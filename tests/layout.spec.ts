import { test, expect } from "@playwright/test";
const evidence = process.env.BLUFFERY_EVIDENCE_DIR || "test-results/evidence";
test("original landing, QR and narrow controls render without overflow", async ({
  page,
}) => {
  await page.goto("/");
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(
      page.getByRole("heading", { name: "bluffery" }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `${evidence}/landing-${width}.png`,
      fullPage: true,
    });
  }
  await page.getByLabel("Je naam").fill("Lange naam aan de tafel");
  await page.getByRole("button", { name: "Nieuwe tafel" }).click();
  await expect(page.locator("img.qr")).toBeVisible();
  const cookie = (await page.context().cookies()).find(
    (c) => c.name === "bluffery",
  );
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.sameSite).toBe("Strict");
  const link = (await page
    .getByRole("button", { name: "Delen" })
    .getAttribute("data-share-url"))!;
  expect(link).not.toContain(cookie!.value);
  expect(new URL(link).searchParams.get("code")).toMatch(/^[A-F0-9]{6}$/);
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.getByRole("button", { name: "Spelregels" }).click();
  await expect(page.getByRole("heading", { name: "Privacy" })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("joining via a QR code hides 'Nieuwe tafel' until the code is cleared", async ({
  page,
}) => {
  await page.goto("/?code=ABC123");
  await expect(page.getByLabel("Tafelcode")).toHaveValue("ABC123");
  await expect(
    page.getByRole("button", { name: "Nieuwe tafel" }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Doe mee" })).toBeVisible();
  await page.getByLabel("Tafelcode").fill("");
  await expect(
    page.getByRole("button", { name: "Nieuwe tafel" }),
  ).toBeVisible();
});
