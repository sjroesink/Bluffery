import { test, expect } from "@playwright/test";
const evidence = process.env.BLUFFERY_EVIDENCE_DIR || "test-results/evidence";
test("four independent phones finish a whole game through all risk endings", async ({
  browser,
}) => {
  const ctx = await Promise.all(
    [0, 1, 2, 3].map(() =>
      browser.newContext({ viewport: { width: 320, height: 760 } }),
    ),
  );
  const pages = await Promise.all(ctx.map((c) => c.newPage()));
  try {
    await pages[0].goto("/");
    await pages[0].getByLabel("Je naam").fill("Host");
    await pages[0].getByRole("button", { name: "Nieuwe tafel" }).click();
    const code = await pages[0].getByTestId("room-code").innerText();
    for (let i = 1; i < 4; i++) {
      await pages[i].goto("/?code=" + code);
      await pages[i].getByLabel("Je naam").fill("Speler " + i);
      await pages[i].getByRole("button", { name: "Doe mee" }).click();
      await expect(pages[i].getByText("Wachten op de host")).toBeVisible();
    }
    await expect(pages[0].getByText("4 / 10", { exact: true })).toBeVisible();
    await pages[0].getByRole("button", { name: "Minder beurten" }).click();
    await expect(pages[0].getByLabel("Beurten per speler")).toHaveValue("1");
    await expect(
      pages[0].getByRole("button", { name: "Start", exact: true }),
    ).toBeEnabled();
    await pages[0].getByRole("button", { name: "Start", exact: true }).click();
    let questions = new Set<string>();
    for (let turn = 0; turn < 4; turn++) {
      const p = pages[turn];
      await p.getByRole("button", { name: "Uitdelen", exact: true }).click();
      await expect(p.getByTestId("pot")).toBeVisible();
      const st = await (await p.request.get("/api/state")).json();
      expect(st.answer).toBeUndefined();
      expect(st.sources).toBeUndefined();
      await expect(p.getByText("Bronnen", { exact: true })).toHaveCount(0);
      expect(questions.has(st.question)).toBe(false);
      questions.add(st.question);
      let blue = "";
      let reds: string[] = [];
      for (let i = 0; i < 4; i++) {
        if (i === turn) continue;
        await expect(pages[i].getByTestId("private-answer")).toBeVisible();
        const v = await (await pages[i].request.get("/api/state")).json();
        if (v.role === "blue") blue = v.me;
        else reds.push(v.me);
      }
      if (turn === 1) {
        await p
          .getByTestId("suspect-" + blue)
          .getByRole("button", { name: /^(Bluf!|\+1 bonus) / })
          .click();
        await expect(
          p.getByRole("heading", { name: /was eerlijk$/ }),
        ).toBeVisible();
      } else if (turn === 2) {
        for (const id of [...reds, blue]) {
          await p
            .getByTestId("suspect-" + id)
            .getByRole("button", { name: /^(Bluf!|\+1 bonus) / })
            .click();
        }
        await expect(
          p.getByRole("heading", { name: "Allemaal ontmaskerd" }),
        ).toBeVisible();
      } else {
        if (turn === 3)
          await p
            .getByTestId("suspect-" + reds[0])
            .getByRole("button", { name: /^(Bluf!|\+1 bonus) / })
            .click();
        await p.getByRole("button", { name: /^Stop & pak/ }).click();
        await expect(p.getByRole("heading", { name: "Binnen" })).toBeVisible();
      }
      await expect(p.getByTestId("settled-answer")).toBeVisible();
      await p.getByText("Bronnen", { exact: true }).click();
      const settled = await (await p.request.get("/api/state")).json();
      for (const source of settled.sources) {
        const item = p
          .locator("li")
          .filter({
            has: p.getByRole("link", {
              name: source.publisher + " · " + source.title,
              exact: true,
            }),
          });
        await expect(item).toContainText(source.rightsNote);
        await expect(item.getByRole("link")).toHaveAttribute(
          "href",
          source.url,
        );
      }
      expect(
        await p.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await p.getByRole("button", { name: "Volgende beurt" }).click();
    }
    for (const p of pages)
      await expect(
        p.getByRole("heading", { name: / (wint|winnen)$/ }),
      ).toBeVisible();
    await expect(pages[0].locator(".podium .step")).toHaveCount(3);
    await pages[0].screenshot({
      path: evidence + "/finished-320.png",
      fullPage: true,
    });
    await pages[0]
      .getByRole("button", { name: "Nog een potje" })
      .click();
    await expect(
      pages[0].getByRole("heading", { name: "Aan tafel" }),
    ).toBeVisible();
  } finally {
    await Promise.all(ctx.map((c) => c.close()));
  }
});

test("lost create response survives reload and exact retry does not create twice", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Je naam").fill("Retry Test");
  let once = true;
  await page.route("**/api/command", async (route) => {
    if (once) {
      once = false;
      const r = await route.fetch();
      expect(r.status()).toBe(200);
      await route.abort("failed");
    } else await route.continue();
  });
  await page.getByRole("button", { name: "Nieuwe tafel" }).click();
  await expect(
    page.getByRole("button", { name: "Dezelfde actie opnieuw proberen" }),
  ).toBeVisible();
  const pending = await page.evaluate(() =>
    localStorage.getItem("bluffery.pending.v1"),
  );
  expect(pending).toBeTruthy();
  await page.reload();
  await expect(page.getByTestId("room-code")).toBeVisible();
  const code = await page.getByTestId("room-code").innerText();
  await page
    .getByRole("button", { name: "Dezelfde actie opnieuw proberen" })
    .click();
  await expect(
    page.getByRole("button", { name: "Dezelfde actie opnieuw proberen" }),
  ).toHaveCount(0);
  await expect(page.getByTestId("room-code")).toHaveText(code);
  const s = await (await page.request.get("/api/state")).json();
  expect(s.version).toBe(1);
  expect(s.players).toHaveLength(1);
  // The notice hides while the retry is in flight; the cleared intent marks its confirmation.
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("bluffery.pending.v1")))
    .toBeNull();
});

test("corrupt persisted intent fails closed without overwriting uncertain action", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.setItem("bluffery.pending.v1", "null"));
  await Promise.all([
    page.waitForResponse((r) => r.url().endsWith("/api/state")),
    page.reload(),
  ]);
  await page.evaluate(
    () =>
      new Promise<void>((r) =>
        requestAnimationFrame(() => requestAnimationFrame(() => r())),
      ),
  );
  await page.getByLabel("Je naam").fill("Blocked");
  await expect(page.getByRole("alert")).toContainText("onleesbaar");
  await expect(
    page.getByRole("button", { name: "Nieuwe tafel" }),
  ).toBeDisabled();
  expect(
    await page.evaluate(() => localStorage.getItem("bluffery.pending.v1")),
  ).toBe("null");
});

test("host allows skipping and the guesser swaps the question until the first Bluf!", async ({
  browser,
}) => {
  const ctx = await Promise.all(
    [0, 1, 2, 3].map(() =>
      browser.newContext({ viewport: { width: 320, height: 760 } }),
    ),
  );
  const pages = await Promise.all(ctx.map((c) => c.newPage()));
  try {
    await pages[0].goto("/");
    await pages[0].getByLabel("Je naam").fill("Host");
    await pages[0].getByRole("button", { name: "Nieuwe tafel" }).click();
    const code = await pages[0].getByTestId("room-code").innerText();
    for (let i = 1; i < 4; i++) {
      await pages[i].goto("/?code=" + code);
      await pages[i].getByLabel("Je naam").fill("Speler " + i);
      await pages[i].getByRole("button", { name: "Doe mee" }).click();
      await expect(pages[i].getByText("Wachten op de host")).toBeVisible();
    }
    const toggle = pages[0].getByRole("switch", { name: "Vragen overslaan" });
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await pages[0].getByRole("button", { name: "Start", exact: true }).click();
    await pages[0].getByRole("button", { name: "Uitdelen", exact: true }).click();
    const question = pages[0].locator(".question h1");
    const first = await question.innerText();
    await expect(pages[1].locator(".role-question")).toHaveText(first);
    await pages[0].getByRole("button", { name: "Andere vraag" }).click();
    await expect(question).not.toHaveText(first);
    const second = await question.innerText();
    await expect(pages[1].locator(".role-question")).toHaveText(second);
    await expect(pages[1].getByTestId("private-answer")).toBeVisible();
    await pages[0]
      .locator(".suspect")
      .first()
      .getByRole("button", { name: /^(Bluf!|\+1 bonus) / })
      .click();
    await expect(
      pages[0].getByRole("button", { name: "Andere vraag" }),
    ).toHaveCount(0);
  } finally {
    await Promise.all(ctx.map((c) => c.close()));
  }
});

test("players leave and the host removes someone mid-game", async ({
  browser,
}) => {
  const ctx = await Promise.all(
    [0, 1, 2, 3, 4, 5].map(() =>
      browser.newContext({ viewport: { width: 320, height: 760 } }),
    ),
  );
  const pages = await Promise.all(ctx.map((c) => c.newPage()));
  try {
    await pages[0].goto("/");
    await pages[0].getByLabel("Je naam").fill("Host");
    await pages[0].getByRole("button", { name: "Nieuwe tafel" }).click();
    const code = await pages[0].getByTestId("room-code").innerText();
    for (let i = 1; i < 6; i++) {
      await pages[i].goto("/?code=" + code);
      await pages[i].getByLabel("Je naam").fill("Speler " + i);
      await pages[i].getByRole("button", { name: "Doe mee" }).click();
      await expect(pages[i].getByText("Wachten op de host")).toBeVisible();
    }
    // Leaving from the lobby.
    await pages[5].getByRole("button", { name: "Tafel verlaten" }).click();
    await pages[5].getByRole("button", { name: "Verlaten", exact: true }).click();
    await expect(pages[5].getByRole("button", { name: "Nieuwe tafel" })).toBeVisible();
    await expect(pages[5].getByRole("alert")).toHaveCount(0);
    await expect(pages[0].getByText("5 / 10", { exact: true })).toBeVisible();
    await pages[0].getByRole("button", { name: "Start", exact: true }).click();
    await pages[0].getByRole("button", { name: "Uitdelen", exact: true }).click();
    await expect(pages[0].getByTestId("pot")).toBeVisible();
    // The host removes a player during the turn, with a second tap to confirm.
    await pages[0].getByRole("button", { name: "Stand" }).click();
    await pages[0].getByRole("button", { name: "Speler 4 verwijderen" }).click();
    await pages[0].getByRole("button", { name: "Speler 4 verwijderen: bevestig" }).click();
    await expect(pages[4].getByRole("alert")).toHaveText("Je zit niet meer aan deze tafel.");
    await expect(pages[4].getByRole("button", { name: "Nieuwe tafel" })).toBeVisible();
    await expect(pages[0].locator(".sheet .standings li")).toHaveCount(4);
    // A player leaves mid-game through the standings sheet.
    await pages[0].getByRole("button", { name: "Sluiten" }).click();
    await expect(pages[0].getByText(/^Beurt 1 \/ (8|4)$/)).toBeVisible();
    await expect(pages[1].getByTestId("private-answer").or(pages[1].getByText("Wachten op uitdelen"))).toBeVisible();
    // Non-guessers have no top bar while a question is out, so finish the turn first.
    if (await pages[0].getByRole("button", { name: /^Stop & pak/ }).isVisible()) {
      await pages[0].getByRole("button", { name: /^Stop & pak/ }).click();
      await pages[0].getByRole("button", { name: "Verder" }).click();
    }
    await pages[3].getByRole("button", { name: "Stand" }).click();
    await pages[3].getByRole("button", { name: "Tafel verlaten" }).click();
    await pages[3].getByRole("button", { name: "Verlaten", exact: true }).click();
    await expect(pages[3].getByRole("button", { name: "Nieuwe tafel" })).toBeVisible();
    await expect(pages[0].getByText("Beurt 1 / 6")).toBeVisible();
    // Down to two players the game ends.
    await pages[0].getByRole("button", { name: "Stand" }).click();
    await pages[0].getByRole("button", { name: "Speler 2 verwijderen" }).click();
    await pages[0].getByRole("button", { name: "Speler 2 verwijderen: bevestig" }).click();
    await expect(pages[1].getByRole("heading", { name: / (wint|winnen)$/ })).toBeVisible();
  } finally {
    await Promise.all(ctx.map((c) => c.close()));
  }
});

test("host hands the role to another player in the lobby", async ({
  browser,
}) => {
  const ctx = await Promise.all(
    [0, 1].map(() =>
      browser.newContext({ viewport: { width: 320, height: 760 } }),
    ),
  );
  const pages = await Promise.all(ctx.map((c) => c.newPage()));
  try {
    await pages[0].goto("/");
    await pages[0].getByLabel("Je naam").fill("Host");
    await pages[0].getByRole("button", { name: "Nieuwe tafel" }).click();
    const code = await pages[0].getByTestId("room-code").innerText();
    await pages[1].goto("/?code=" + code);
    await pages[1].getByLabel("Je naam").fill("Opvolger");
    await pages[1].getByRole("button", { name: "Doe mee" }).click();
    await expect(pages[1].getByText("Wachten op de host")).toBeVisible();
    await pages[0].getByRole("button", { name: "Opvolger host maken" }).click();
    await pages[0]
      .getByRole("button", { name: "Opvolger host maken: bevestig" })
      .click();
    await expect(pages[0].getByText("Wachten op de host")).toBeVisible();
    await expect(pages[1].getByLabel("Beurten per speler")).toBeVisible();
    await expect(
      pages[1].getByRole("button", { name: "Host host maken" }),
    ).toBeVisible();
  } finally {
    await Promise.all(ctx.map((c) => c.close()));
  }
});
