import { test, expect } from "@playwright/test";
const evidence = process.env.VISSIG_EVIDENCE_DIR || "test-results/evidence";
test("four phones play, hide answers from owner-guesser, rotate and resume", async ({
  browser,
}) => {
  const contexts = await Promise.all(
    [0, 1, 2, 3].map(() =>
      browser.newContext({ viewport: { width: 390, height: 844 } }),
    ),
  );
  const pages = await Promise.all(contexts.map((c) => c.newPage()));
  try {
    await pages[0].goto("/");
    await pages[0].getByLabel("Je naam").fill("Noor");
    await pages[0].getByRole("button", { name: "Nieuwe tafel" }).click();
    await expect(pages[0].getByTestId("room-code")).toBeVisible();
    const code = (await pages[0].getByTestId("room-code").innerText()).trim();
    for (let i = 1; i < 4; i++) {
      await pages[i].goto("/?code=" + code);
      await pages[i].getByLabel("Je naam").fill(["", "Sam", "Mila", "Bo"][i]);
      await pages[i].getByRole("button", { name: "Schuif aan" }).click();
      await expect(pages[i].getByText("Wachten op de host")).toBeVisible();
    }
    await expect(pages[0].getByText("4 / 10 spelers")).toBeVisible();
    await pages[0].getByRole("button", { name: "Start het spel" }).click();
    await pages[0].getByRole("button", { name: "Visjes uitdelen" }).click();
    await expect(pages[0].getByText("Jij bent de rader")).toBeVisible();
    const state = await (await pages[0].request.get("/api/state")).json();
    expect(state.answer).toBeUndefined();
    expect(state.roles).toBeUndefined();
    expect(await pages[0].content()).not.toContain("TESTANTWOORD");
    let blue = "",
      red = "";
    for (let i = 1; i < 4; i++) {
      await expect(pages[i].getByTestId("private-answer")).toBeVisible();
      let v = await (await pages[i].request.get("/api/state")).json();
      if (v.role === "blue") blue = v.me;
      else red = v.me;
      expect(v.roles).toBeUndefined();
    }
    await pages[0]
      .getByTestId("fish-" + red)
      .getByRole("button", { name: "Goed / laten staan" })
      .click();
    await expect(pages[0].getByTestId("fish-" + red)).toContainText(
      "Laten staan",
    );
    await pages[0]
      .getByTestId("fish-" + red)
      .getByRole("button", { name: "Fout / omdraaien" })
      .click();
    await expect(pages[0].getByText("1 punt op het spel")).toBeVisible();
    await pages[0].screenshot({
      path: evidence + "/round-mobile.png",
      fullPage: true,
    });
    await pages[0].reload();
    await expect(pages[0].getByText("1 punt op het spel")).toBeVisible();
    await pages[0]
      .getByRole("button", { name: "Stop & punten pakken" })
      .click();
    await expect(pages[0].getByText("Veilig binnen")).toBeVisible();
    await expect(pages[0].getByTestId("settled-answer")).toBeVisible();
    await pages[0].getByRole("button", { name: "Volgende beurt" }).click();
    await expect(
      pages[1].getByRole("button", { name: "Visjes uitdelen" }),
    ).toBeVisible();
    await pages[1].getByRole("button", { name: "Visjes uitdelen" }).click();
    await expect(pages[0].getByTestId("private-answer")).toBeVisible();
    const owner = await (await pages[0].request.get("/api/state")).json();
    expect(owner.answer).toBeTruthy();
    expect(owner.roles).toBeUndefined();
    for (const width of [320, 390, 768, 1280]) {
      await pages[0].setViewportSize({ width, height: 900 });
      expect(
        await pages[0].evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await pages[0].screenshot({
        path: `${evidence}/layout-${width}.png`,
        fullPage: true,
      });
    }
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
});
