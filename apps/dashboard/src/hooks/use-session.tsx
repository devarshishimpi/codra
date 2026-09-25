import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { api } from "@client/lib/api";
import type { AuthSessionUser } from "@codraoss/schema/api";

export interface SessionState {
  user: AuthSessionUser | null;
  permissions: string[] | undefined;
  loading: boolean;
}

const SessionContext = createContext<SessionState>({
  user: null,
  permissions: undefined,
  loading: true,
});

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({
    user: null,
    permissions: undefined,
    loading: true,
  });

  useEffect(() => {
    let cancelled = false;
    api
      .getSession()
      .then((r) => {
        if (!cancelled)
          setState({
            user: r.user,
            permissions: r.permissions,
            loading: false,
          });
      })
      .catch(() => {
        if (!cancelled)
          setState({ user: null, permissions: undefined, loading: false });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo(() => state, [state]);
  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSession() {
  return useContext(SessionContext);
}
