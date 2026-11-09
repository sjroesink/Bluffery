import { test, expect } from "@playwright/test";

test("app menu attributes three source families without revealing a question", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Spelregels" }).click();
  for (const [name, url] of [
    ["WikiDYK", "https://huggingface.co/datasets/YWZBrandon/wikidyk"],
    [
      "Wikipedia · Unusual articles",
      "https://en.wikipedia.org/wiki/Wikipedia:Unusual_articles",
    ],
    ["Open Trivia Database", "https://opentdb.com/"],
  ]) {
    await expect(page.getByRole("link", { name, exact: true })).toHaveAttribute(
      "href",
      url,
    );
  }
  await expect(
    page.getByText(
      "Rechten verschillen per bron; de bronverantwoording en rechtennotitie bij een vraag verschijnen pas na de beurt.",
    ),
  ).toBeVisible();
  await expect(page.getByTestId("settled-answer")).toHaveCount(0);
});
