import type { ApiAction } from "@codraoss/schema/api";
import { useSession } from "@client/hooks/use-session";

// UI-side gate only; the server authorizes every request independently, and absent permissions mean nothing is restricted, so everything is allowed.
export function useCan(action: ApiAction): boolean {
  const { permissions } = useSession();
  if (permissions === undefined) return true;
  return permissions.includes("*") || permissions.includes(action);
}
