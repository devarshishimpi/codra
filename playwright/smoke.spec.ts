import { expect, test } from "@playwright/test";

test("signed-out visitors see the GitHub sign-in page", async ({ page }) => {
  // Keep this smoke test independent of OAuth, Redis session state, and any
  // real GitHub account. The browser still loads the built dashboard from the
  // local Node server; only the session lookup is given a deterministic result
  // matching the server's signed-out 401 response.
  await page.route("**/api/auth/session", async (route) => {
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ error: "Unauthorized" }),
    });
  });

  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Sign in to Codra" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Continue with GitHub" }),
  ).toHaveAttribute("href", "/auth/github");
});
