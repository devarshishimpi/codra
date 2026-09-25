import type { DashboardSessionUser } from "./session-store";

export interface AuthorizationResult {
  identity: DashboardSessionUser;
}

export interface IdentityProvider {
  /**
   * Generates the URL to redirect the user to for authorization.
   */
  beginAuthorization(
    redirectUri: string,
    state: string,
    env: any,
  ): Promise<{ url: string }>;

  /**
   * Validates the callback parameters and exchanges the authorization code for a profile.
   */
  completeAuthorization(
    code: string,
    state: string,
    expectedState: string,
    env: any,
  ): Promise<AuthorizationResult>;
}
