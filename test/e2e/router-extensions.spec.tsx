/**
 * @vitest-environment jsdom
 */
import { expect, it, describe, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { RouterProvider } from "react-router-dom";
import { Boxes } from "lucide-react";
import { api } from "@client/lib/api";
import { ThemeProvider } from "@codraoss/ui/theme";
import { buildRouter, publicRoutes, shellRoutes } from "@client/routes";
import { navItems } from "@client/nav";

vi.mock("@client/lib/api", () => ({
  api: {
    getSession: vi.fn(),
    getRepos: vi.fn(),
    getModelConfigs: vi.fn(),
  },
}));

// createBrowserRouter captures the URL when it is created, so window.history must be set before buildRouter runs.
function renderAt(path: string, build: () => ReturnType<typeof buildRouter>) {
  window.history.pushState({}, "", path);
  const router = build();
  return render(
    <ThemeProvider>
      <RouterProvider router={router} />
    </ThemeProvider>,
  );
}

describe("Dashboard route and nav registries (JSDOM)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getSession).mockResolvedValue({
      user: {
        githubUserId: 42,
        login: "devarshishimpi",
        name: "Devarshi Shimpi",
        avatarUrl: null,
        email: null,
        signedInAt: new Date().toISOString(),
      },
    });
    vi.mocked(api.getRepos).mockResolvedValue({ repos: [] });
    vi.mocked(api.getModelConfigs).mockResolvedValue({
      providers: [],
      configs: [],
    });
  });

  it("exposes the built-in routes as composable arrays", () => {
    expect(publicRoutes.map((r) => r.path)).toEqual(["/"]);
    expect(shellRoutes.map((r) => r.path)).toContain("dashboard");
    expect([...publicRoutes, ...shellRoutes].map((r) => r.path)).not.toContain(
      "*",
    );
  });

  it("renders an injected shell route and its nav entry", async () => {
    const { container } = renderAt("/teams", () =>
      buildRouter({
        shellRoutes: [{ path: "teams", element: <h1>Teams</h1> }],
        navItems: [{ to: "/teams", label: "Teams", icon: Boxes }],
      }),
    );

    expect(await screen.findByRole("heading", { name: "Teams" })).toBeTruthy();
    await waitFor(() =>
      expect(container.querySelector('a[href="/teams"]')).toBeTruthy(),
    );
  });

  it("still falls through to the not-found route for unknown paths", async () => {
    renderAt("/definitely-not-a-route", () =>
      buildRouter({
        shellRoutes: [{ path: "teams", element: <h1>Teams</h1> }],
      }),
    );

    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "Teams" })).toBeNull(),
    );
  });

  it("hides a nav entry whose required permission is absent from the session", async () => {
    vi.mocked(api.getSession).mockResolvedValue({
      user: {
        githubUserId: 42,
        login: "devarshishimpi",
        name: "Devarshi Shimpi",
        avatarUrl: null,
        email: null,
        signedInAt: new Date().toISOString(),
      },
      permissions: ["jobs.read"],
    });

    const { container } = renderAt("/teams", () =>
      buildRouter({
        shellRoutes: [{ path: "teams", element: <h1>Teams</h1> }],
        navItems: [
          {
            to: "/teams",
            label: "Teams",
            icon: Boxes,
            requiresAction: "teams.read",
          },
        ],
      }),
    );

    expect(await screen.findByRole("heading", { name: "Teams" })).toBeTruthy();
    await waitFor(() => {
      expect(container.querySelector('a[href="/teams"]')).toBeNull();
    });
    expect(navItems.every((item) => item.requiresAction === undefined)).toBe(
      true,
    );
  });
});
