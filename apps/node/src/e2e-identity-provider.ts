import type {
  DashboardSessionUser,
  IdentityProvider,
} from "@codraoss/core/ports";

/**
 * Synthetic identity provider used only by the disposable Playwright server.
 * It exercises the real OAuth state/callback/session path without contacting
 * GitHub or requiring user credentials.
 */
export class E2EIdentityProvider implements IdentityProvider {
  private readonly identity: DashboardSessionUser = {
    provider: "github",
    providerUserId: "90000001",
    login: "codra-e2e",
    name: "Codra E2E User",
    avatarUrl: null,
    email: "codra-e2e@example.invalid",
    signedInAt: "2026-01-01T00:00:00.000Z",
    metadata: {
      githubUserId: 90000001,
      githubUsername: "codra-e2e",
    },
  };

  async beginAuthorization(
    redirectUri: string,
    state: string,
  ): Promise<{ url: string }> {
    const url = new URL("https://codra-e2e.invalid/authorize");
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("state", state);
    return { url: url.toString() };
  }

  async completeAuthorization(
    code: string,
    state: string,
    expectedState: string,
  ): Promise<{ identity: DashboardSessionUser }> {
    if (code !== "codra-e2e-code" || state !== expectedState) {
      throw new Error("Invalid synthetic E2E authorization callback.");
    }

    return { identity: { ...this.identity } };
  }
}
