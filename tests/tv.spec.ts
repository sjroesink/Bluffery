import { test, expect, type Page } from "@playwright/test";
const evidence = process.env.BLUFFERY_EVIDENCE_DIR || "test-results/evidence";
async function noOverflow(page: Page) {
  const wide = await page.evaluate(
    () => document.documentElement.scrollWidth - innerWidth,
  );
  expect(wide).toBeLessThanOrEqual(0);
}
test("tv mode: a shared screen watches, phones type answers", async ({
  browser,
}) => {
  const contexts = await Promise.all(
    [0, 1, 2, 3].map((i) =>
      browser.newContext({
        viewport: { width: i === 1 ? 320 : 390, height: 844 },
      }),
    ),
  );
  const tvContext = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
  });
  const pages = await Promise.all(contexts.map((c) => c.newPage()));
  const tv = await tvContext.newPage();
  try {
    await pages[0].goto("/");
    await pages[0].getByLabel("Je naam").fill("Noor");
    await pages[0].getByRole("button", { name: "Nieuwe tafel" }).click();
    const code = (await pages[0].getByTestId("room-code").innerText()).trim();
    await pages[0].getByRole("switch", { name: "Tv-modus" }).click();
    await expect(pages[0].getByTestId("tv-hint")).toContainText("/tv");

    await tv.goto("/tv");
    await tv.getByLabel("Tafelcode").fill(code);
    await tv.getByRole("button", { name: "Meekijken" }).click();
    await expect(tv.getByTestId("tv-code")).toHaveText(code);
    await expect(pages[0].getByTestId("tv-hint")).toHaveText("Tv gekoppeld");

    for (let i = 1; i < 4; i++) {
      await pages[i].goto("/?code=" + code);
      await pages[i].getByLabel("Je naam").fill(["", "Sam", "Mila", "Bo"][i]);
      await pages[i].getByRole("button", { name: "Doe mee" }).click();
      await expect(pages[i].getByText("Wachten op de host")).toBeVisible();
    }
    // Een vrij personage kiezen; dat van een ander is niet te kiezen.
    const pick = pages[1]
      .locator('.cast-pick[aria-pressed="false"]:not([disabled])')
      .first();
    const chosen = await pick.getAttribute("aria-label");
    await pick.click();
    await expect(
      pages[1].getByRole("button", { name: chosen!, exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(tv.getByText(chosen!, { exact: true })).toBeVisible();
    await expect(tv.locator(".tv-seat")).toHaveCount(4);
    await pages[1].screenshot({ path: evidence + "/tv-phone-lobby.png", fullPage: true });
    await noOverflow(pages[1]);
    await tv.screenshot({ path: evidence + "/tv-lobby.png" });
    await noOverflow(tv);

    await pages[0].getByRole("button", { name: "Start", exact: true }).click();
    await pages[0].getByRole("button", { name: "Uitdelen", exact: true }).click();
    await expect(tv.locator(".tv-question h1")).toContainText("TESTVRAAG");
    await expect(pages[0].getByTestId("answers-in")).toContainText("0 / 3");
    await expect(
      pages[0].getByRole("button", { name: "Stop & pak 0" }),
    ).toBeDisabled();

    let red = "";
    for (let i = 1; i < 4; i++) {
      expect(await tv.content()).not.toContain("TESTANTWOORD");
      const v = await (await pages[i].request.get("/api/state")).json();
      const field = pages[i].getByLabel("Jouw antwoord");
      if (v.role === "blue") await expect(field).toHaveValue(/TESTANTWOORD/);
      else {
        red = v.me;
        await field.fill("Verzonnen door " + ["", "Sam", "Mila", "Bo"][i]);
      }
      if (i === 1) {
        await pages[1].screenshot({ path: evidence + "/tv-phone-answer.png", fullPage: true });
        await noOverflow(pages[1]);
      }
      await pages[i].getByRole("button", { name: "Insturen" }).click();
      await expect(pages[i].getByTestId("my-answer")).toBeVisible();
      if (i === 2) {
        await tv.screenshot({ path: evidence + "/tv-collecting.png" });
        await expect(tv.getByText("2 / 3 antwoorden binnen")).toBeVisible();
      }
    }
    await expect(tv.locator(".tv-card-text", { hasText: "Verzonnen door" })).toHaveCount(2);
    await expect(pages[0].getByTestId("suspect-" + red)).toContainText("Verzonnen door");
    await pages[0]
      .getByTestId("suspect-" + red)
      .getByRole("button", { name: /^(Bluf!|\+1 bonus) / })
      .click();
    await expect(tv.locator(".tv-card.red .stamp")).toHaveText("Bluffer");
    await tv.screenshot({ path: evidence + "/tv-judging.png" });
    await noOverflow(tv);

    await pages[0].getByRole("button", { name: /^Stop & pak/ }).click();
    await expect(tv.getByTestId("tv-answer")).toContainText("TESTANTWOORD");
    await tv.screenshot({ path: evidence + "/tv-settled.png" });
    await tv.setViewportSize({ width: 1280, height: 720 });
    await noOverflow(tv);

    // Na een herlaadbeurt kijkt het scherm gewoon verder.
    await tv.reload();
    await expect(tv.getByTestId("tv-answer")).toBeVisible();
    await tv.getByRole("button", { name: "Stoppen met meekijken" }).click();
    await expect(tv.getByRole("button", { name: "Meekijken" })).toBeVisible();
  } finally {
    await Promise.all([...contexts, tvContext].map((c) => c.close()));
  }
});
