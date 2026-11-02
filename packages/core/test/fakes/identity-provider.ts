import type {
  IdentityProvider,
  AuthorizationResult,
} from "../../src/ports/identity-provider";
import type { DashboardSessionUser } from "../../src/ports/session-store";

export class FakeIdentityProvider implements IdentityProvider {
  public defaultUser: DashboardSessionUser = {
    provider: "github",
    providerUserId: "test-user-1",
    login: "testuser",
    name: "Test User",
    avatarUrl: "https://example.com/avatar.png",
    email: "test@example.com",
    signedInAt: new Date().toISOString(),
    metadata: {},
  };

  public simulatedError: string | null = null;

  async beginAuthorization(
    redirectUri: string,
    state: string,
    _env: any,
  ): Promise<{ url: string }> {
    const url = new URL("https://fake-provider.com/authorize");
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("state", state);
    return { url: url.toString() };
  }

  async completeAuthorization(
    code: string,
    state: string,
    expectedState: string,
    _env: any,
  ): Promise<AuthorizationResult> {
    if (this.simulatedError) {
      throw new Error(this.simulatedError);
    }
    if (state !== expectedState) {
      throw new Error("Invalid state");
    }
    return {
      identity: { ...this.defaultUser },
    };
  }
}
