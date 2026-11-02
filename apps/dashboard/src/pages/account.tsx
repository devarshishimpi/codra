import { LoadError } from "@codraoss/ui";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "@client/lib/api";
import { PageHeader } from "@client/components/layout/page-header";
import {
  getStoredTimeZone,
  resolvedTimeZone,
  setStoredTimeZone,
} from "@client/lib/timezone";
import type { AccountSettings, AuthSessionUser } from "@codraoss/schema/api";

import { ProfileCard } from "@client/components/features/account/profile-card";
import { AccountDetailsSection } from "@client/components/features/account/details-section";

export function AccountPage() {
  const [user, setUser] = useState<AuthSessionUser | null>(null);
  const [account, setAccount] = useState<AccountSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // A ref, not state: it only guards concurrent saves and is never rendered.
  const savingZone = useRef(false);
  // State-driven, not a render-time localStorage read - that wasn't reactive and never reflected a save.
  const [zonePref, setZonePref] = useState<string | null>(() =>
    getStoredTimeZone(),
  );

  const load = async () => {
    setError(null);
    try {
      const [session, accountRes] = await Promise.all([
        api.getSession(),
        api.getAccount().catch(() => null),
      ]);
      setUser(session.user);
      setAccount(accountRes?.account ?? null);
      // Mirror the server's choice locally so other pages format in the same zone; only on success, so a failed fetch doesn't reset the local preference.
      if (accountRes?.account) {
        setStoredTimeZone(accountRes.account.timezone ?? null);
        setZonePref(accountRes.account.timezone ?? null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load your account.");
    } finally {
      setLoading(false);
    }
  };

  const saveTimezone = async (zone: string) => {
    if (savingZone.current) return;
    const previous = zonePref;
    // Optimistic: reflects the choice immediately and reverts if the server rejects it.
    setZonePref(zone);
    setStoredTimeZone(zone);
    savingZone.current = true;
    try {
      const res = await api.updateAccountTimezone(zone);
      setAccount(res.account);
      setStoredTimeZone(res.account.timezone ?? null);
      setZonePref(res.account.timezone ?? null);
      toast.success("Time zone updated", {
        description: `Timestamps now show in ${resolvedTimeZone()}.`,
      });
    } catch (e) {
      setZonePref(previous);
      setStoredTimeZone(previous);
      toast.error("Could not update time zone", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      savingZone.current = false;
    }
  };

  useEffect(() => {
    void load();
  }, []);

  // Falls back to GitHub profile name (then login) until the user sets their own.
  const displayName =
    account?.accountName?.trim() ||
    user?.name?.trim() ||
    user?.login ||
    "GitHub user";
  const initial = displayName.charAt(0).toUpperCase();
  const profileUrl = user
    ? `https://github.com/${user.login}`
    : "https://github.com";

  // Skeletons replace content only; chrome and labels stay rendered so the page doesn't reflow when data lands.
  const pending = loading || !user;

  return (
    <section className="page-enter flex flex-col gap-5 pb-20">
      <PageHeader
        title="Account"
        description="Your Codra profile and account details."
      />

      {error && (
        <LoadError
          title="Couldn't load your account"
          detail={error}
          onRetry={() => {
            setLoading(true);
            void load();
          }}
          retrying={loading}
        />
      )}

      {(loading || user) && (
        <>
          <ProfileCard
            user={user}
            pending={pending}
            displayName={displayName}
            initial={initial}
            profileUrl={profileUrl}
            onAccountChange={setAccount}
          />

          <AccountDetailsSection
            user={user}
            account={account}
            pending={pending}
            displayName={displayName}
            zonePref={zonePref}
            onZoneChange={(zone) => void saveTimezone(zone)}
          />
        </>
      )}
    </section>
  );
}
