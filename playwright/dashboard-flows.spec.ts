import { expect, test, type Page, type Route } from "@playwright/test";
import {
  detailJob,
  detailJobId,
  globalModelFixture,
  jobDiffFixture,
  jobSummaries,
  modelsFixture,
  repoFixture,
  statsFixture,
} from "./fixtures";

const e2eCode = "codra-e2e-code";

async function fulfillJson(
  route: Route,
  body: unknown,
  headers?: Record<string, string>,
  status = 200,
) {
  await route.fulfill({
    status,
    contentType: "application/json",
    headers,
    body: JSON.stringify(body),
  });
}

async function installApiMocks(page: Page) {
  const repo = structuredClone(repoFixture);

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const { pathname, searchParams } = url;

    // Keep session lookup real: it verifies the cookie created by the OAuth callback.
    if (pathname === "/api/auth/session") {
      await route.continue();
      return;
    }

    if (pathname === "/api/jobs" && request.method() === "GET") {
      let jobs = [...jobSummaries];
      const search = searchParams.get("search")?.toLowerCase();
      const status = searchParams.get("status");

      if (search) {
        jobs = jobs.filter((job) =>
          `${job.prTitle ?? ""} ${job.owner}/${job.repo} #${job.prNumber}`
            .toLowerCase()
            .includes(search),
        );
      }

      if (status) {
        jobs = jobs.filter((job) => job.status === status);
      }

      const total = jobs.length;
      const offset = Number(searchParams.get("offset") ?? 0);
      const limit = Number(searchParams.get("limit") ?? 20);

      await fulfillJson(route, {
        jobs: jobs.slice(offset, offset + limit),
        total,
      });
      return;
    }

    if (pathname === `/api/jobs/${detailJobId}` && request.method() === "GET") {
      await fulfillJson(route, { job: detailJob }, { etag: '"codra-e2e-job"' });
      return;
    }

    if (
      pathname === `/api/jobs/${detailJobId}/diffs` &&
      request.method() === "GET"
    ) {
      await fulfillJson(route, jobDiffFixture);
      return;
    }

    if (pathname === "/api/stats" && request.method() === "GET") {
      await fulfillJson(route, { stats: statsFixture });
      return;
    }

    if (pathname === "/api/auth/updates-email" && request.method() === "GET") {
      await fulfillJson(route, {
        status: "subscribed",
        email: "codra-e2e@example.invalid",
        updatedAt: "2026-11-18T10:00:00.000Z",
      });
      return;
    }

    if (pathname === "/api/repos" && request.method() === "GET") {
      await fulfillJson(route, { repos: [repo] });
      return;
    }

    if (pathname === "/api/models" && request.method() === "GET") {
      await fulfillJson(route, modelsFixture);
      return;
    }

    if (pathname === "/api/models/global" && request.method() === "GET") {
      await fulfillJson(route, globalModelFixture);
      return;
    }

    if (
      pathname === `/api/repos/${repo.owner}/${repo.repo}/config` &&
      request.method() === "PATCH"
    ) {
      const payload = request.postDataJSON() as {
        enabled?: boolean;
        model?: { main?: string | null };
      };

      if (payload.enabled !== undefined) {
        repo.enabled = payload.enabled;
      }

      if (payload.model?.main !== undefined) {
        repo.mainModel = payload.model.main;
      }

      await fulfillJson(route, { ok: true });
      return;
    }

    // Fail closed for unexpected API traffic so tests never leak into a real backend.
    await fulfillJson(
      route,
      { error: `Unmocked E2E endpoint: ${request.method()} ${pathname}` },
      undefined,
      501,
    );
  });
}

async function signInThroughSyntheticOAuth(page: Page) {
  const authStart = await page.request.get(
    new URL("/auth/github", page.url()).toString(),
    { maxRedirects: 0 },
  );

  expect(authStart.status()).toBe(302);

  const authorizationUrl = authStart.headers().location;
  expect(authorizationUrl).toBeTruthy();

  const state = new URL(authorizationUrl!).searchParams.get("state");
  expect(state).toBeTruthy();

  await page.goto(
    `/auth/github/callback?code=${e2eCode}&state=${encodeURIComponent(state!)}`,
  );

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(
    page.getByRole("link", { name: "Codra dashboard" }),
  ).toBeVisible();
}

async function openAuthenticatedPage(page: Page, path: string) {
  await installApiMocks(page);
  await page.goto("/");
  await signInThroughSyntheticOAuth(page);
  await page.goto(path);
}

test.describe("Codra browser flows", () => {
  test("landing page and synthetic GitHub OAuth callback reach the dashboard", async ({
    page,
  }) => {
    await installApiMocks(page);
    await page.goto("/");

    await expect(
      page.getByRole("heading", { name: "Sign in to Codra" }),
    ).toBeVisible();

    await expect(
      page.getByRole("link", { name: "Continue with GitHub" }),
    ).toHaveAttribute("href", "/auth/github");

    await signInThroughSyntheticOAuth(page);

    const sessionResponse = await page.request.get(
      new URL("/api/auth/session", page.url()).toString(),
    );

    expect(sessionResponse.status()).toBe(200);
    expect((await sessionResponse.json()).user.login).toBe("codra-e2e");
  });

  test("dashboard overview displays KPIs and recent reviews and changes its time range", async ({
    page,
  }) => {
    await openAuthenticatedPage(page, "/dashboard");

    await expect(
      page.getByRole("heading", { name: "Dashboard" }),
    ).toBeVisible();

    await expect(page.getByText("Total reviews")).toBeVisible();
    await expect(page.getByText("Input tokens")).toBeVisible();
    await expect(page.getByText("Output tokens")).toBeVisible();
    await expect(page.getByText("Comments posted")).toBeVisible();

    await expect(
      page.getByRole("heading", { name: "Recent reviews" }),
    ).toBeVisible();

    await expect(
      page.getByRole("link", { name: "Harden dashboard authorization" }),
    ).toBeVisible();

    const selectedRangeRequest = page.waitForRequest((request) => {
      const requestUrl = new URL(request.url());

      return (
        requestUrl.pathname === "/api/stats" &&
        requestUrl.searchParams.get("days") === "30"
      );
    });

    await page.getByRole("button", { name: "Last 14 days" }).click();
    await page.getByRole("option", { name: "Last 30 days" }).click();

    await selectedRangeRequest;
  });

  test("jobs can be searched, filtered by status, and paginated", async ({
    page,
  }) => {
    await openAuthenticatedPage(page, "/jobs");

    await expect(page.getByRole("heading", { name: "Jobs" })).toBeVisible();

    const search = page.getByRole("textbox", {
      name: "Search jobs by title or number",
    });

    const searchRequest = page.waitForRequest((request) => {
      const requestUrl = new URL(request.url());

      return (
        requestUrl.pathname === "/api/jobs" &&
        requestUrl.searchParams.get("search") ===
          "Harden dashboard authorization"
      );
    });

    await search.fill("Harden dashboard authorization");
    await searchRequest;

    await expect(
      page.getByRole("link", { name: "Harden dashboard authorization" }),
    ).toBeVisible();

    await expect(
      page.getByRole("link", { name: "Update dashboard module 2" }),
    ).toHaveCount(0);

    const clearedSearchRequest = page.waitForRequest((request) => {
      const requestUrl = new URL(request.url());

      return (
        requestUrl.pathname === "/api/jobs" &&
        !requestUrl.searchParams.has("search")
      );
    });

    await search.fill("");
    await clearedSearchRequest;

    await page.getByRole("button", { name: "All statuses" }).click();
    await page.getByRole("option", { name: "Failed" }).click();

    await expect(
      page.getByRole("link", { name: "Update dashboard module 3" }),
    ).toBeVisible();

    await expect(
      page.getByRole("link", { name: "Update dashboard module 2" }),
    ).toHaveCount(0);

    const allStatusesRequest = page.waitForRequest((request) => {
      const requestUrl = new URL(request.url());

      return (
        requestUrl.pathname === "/api/jobs" &&
        !requestUrl.searchParams.has("status") &&
        !requestUrl.searchParams.has("search")
      );
    });

    await page.getByRole("button", { name: "Failed" }).click();
    await page.getByRole("option", { name: "All statuses" }).click();

    await allStatusesRequest;

    const nextPageRequest = page.waitForRequest((request) => {
      const requestUrl = new URL(request.url());

      return (
        requestUrl.pathname === "/api/jobs" &&
        requestUrl.searchParams.get("offset") === "10"
      );
    });

    await page.getByRole("button", { name: "Next page" }).click();
    await nextPageRequest;

    await expect(page.getByText("2 / 2")).toBeVisible();

    await expect(
      page.getByRole("link", { name: "Update dashboard module 11" }),
    ).toBeVisible();

    // Navigate back to the first page.
    const previousPageRequest = page.waitForRequest((request) => {
      const requestUrl = new URL(request.url());

      return (
        requestUrl.pathname === "/api/jobs" &&
        requestUrl.searchParams.get("offset") === "0"
      );
    });

    await page.getByRole("button", { name: "Previous page" }).click();
    await previousPageRequest;

    await expect(page.getByText("1 / 2")).toBeVisible();

    await expect(
      page.getByRole("link", { name: "Update dashboard module 1" }),
    ).toBeVisible();
  });

  test("job detail shows progress, findings, and the changed-file diff viewer", async ({
    page,
  }) => {
    await openAuthenticatedPage(page, `/jobs/${detailJobId}`);

    await expect(
      page.getByRole("heading", { name: "Add account menu protections" }),
    ).toBeVisible();

    await expect(page.getByText("Progress steps")).toBeVisible();
    await expect(page.getByText("Fetch pull request")).toBeVisible();
    await expect(page.getByText("Review changed files")).toBeVisible();

    await expect(page.getByRole("heading", { name: "Findings" })).toBeVisible();

    await page.getByText("src/components/AccountMenu.tsx").first().click();

    await expect(page.getByText("Inline comments (1)")).toBeVisible();

    await expect(
      page.getByText("Check authorization before opening the menu"),
    ).toBeVisible();

    await page.getByRole("tab", { name: "Severity" }).click();

    // Scope the severity assertion to the finding article to avoid matching
    // the same P1 label in other UI elements such as filters.
    await expect(
      page.getByRole("article").getByText("P1", { exact: true }).first(),
    ).toBeVisible();

    await page.getByRole("tab", { name: "Files", exact: true }).click();

    await page.getByRole("tab", { name: "Files changed" }).click();

    await expect(page.getByRole("heading", { name: "Files" })).toBeVisible();

    await expect(page.getByText("if (!canOpen) return null;")).toBeVisible();
  });

  test("repository review can be paused and its model strategy can be updated", async ({
    page,
  }) => {
    await openAuthenticatedPage(page, "/repos");

    await expect(
      page.getByRole("heading", { name: "Repositories" }),
    ).toBeVisible();

    await expect(page.getByText("acme/web-app")).toBeVisible();

    // Scope to the application root to avoid matching the "Enabled" dropdown option.
    await expect(
      page.locator("#root").getByText("Enabled", { exact: true }).first(),
    ).toBeVisible();

    await page
      .getByRole("switch", { name: "Pause reviews for acme/web-app" })
      .click();

    await expect(
      page.locator("#root").getByText("Paused", { exact: true }).first(),
    ).toBeVisible();

    await page.getByRole("button", { name: "Edit" }).click();

    const dialog = page.getByRole("dialog");

    await expect(dialog.getByText("Edit model strategy")).toBeVisible();
    await expect(dialog.getByText("acme/web-app")).toBeVisible();
    await expect(dialog.getByText("Provider")).toBeVisible();
    await expect(dialog.getByText("Model", { exact: true })).toBeVisible();

    // Select a different model from the configured test fixtures.
    await dialog.getByRole("button", { name: /GPT-4o mini/ }).click();

    // The Select options are rendered in a portal outside the dialog.
    await page.getByRole("option", { name: "GPT-4.1 mini" }).click();

    const updateResponse = page.waitForResponse((response) => {
      return (
        response.request().method() === "PATCH" &&
        new URL(response.url()).pathname === "/api/repos/acme/web-app/config"
      );
    });

    const updateRequest = page.waitForRequest((request) => {
      return (
        request.method() === "PATCH" &&
        new URL(request.url()).pathname === "/api/repos/acme/web-app/config"
      );
    });

    await dialog.getByRole("button", { name: "Apply" }).click();

    const [request, response] = await Promise.all([
      updateRequest,
      updateResponse,
    ]);

    expect(response.status()).toBe(200);

    expect(request.postDataJSON()).toMatchObject({
      model: {
        main: "gpt-4.1-mini",
      },
    });
  });

  test("stats charts render without browser errors", async ({ page }) => {
    const pageErrors: string[] = [];

    page.on("pageerror", (error) => pageErrors.push(error.message));

    await openAuthenticatedPage(page, "/stats");

    await expect(
      page.getByRole("heading", { name: "Review metrics" }),
    ).toBeVisible();

    await expect(page.getByText("Review Flow")).toBeVisible();
    await expect(page.getByText("Token Volume")).toBeVisible();

    await expect(page.locator("svg.recharts-surface").first()).toBeVisible();
    await expect(page.locator(".recharts-area-area")).toHaveCount(2);
    await expect(page.locator(".recharts-bar-rectangle").first()).toBeVisible();

    expect(pageErrors).toEqual([]);
  });

  test("theme preference persists after reload", async ({ page }) => {
    await openAuthenticatedPage(page, "/dashboard");

    const root = page.locator("html");
    const originalTheme = await root.getAttribute("data-theme");

    await page.getByRole("button", { name: "Toggle theme" }).first().click();

    await expect
      .poll(() => root.getAttribute("data-theme"))
      .not.toBe(originalTheme);

    const selectedTheme = await root.getAttribute("data-theme");

    expect(["light", "dark"]).toContain(selectedTheme);

    expect(await page.evaluate(() => localStorage.getItem("codra-theme"))).toBe(
      selectedTheme,
    );

    await page.reload();

    await expect(root).toHaveAttribute("data-theme", selectedTheme!);
  });
});
