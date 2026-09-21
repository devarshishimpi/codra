import { SectionCard, Select, Skeleton, Text } from '@codraoss/ui';

import { Mail } from 'lucide-react';
import {
  COMMON_TIME_ZONES,
  DEFAULT_TIME_ZONE,
  browserTimeZone,
  formatDateTime,
  resolvedTimeZone,
  timeZoneOffsetLabel,
} from '@client/lib/timezone';
import type { AccountSettings, AuthSessionUser } from '@codraoss/schema/api';

import { DetailGroup, RevealOnClick, DetailRow } from './detail-rows';

// No "Automatic" option: defaults to UTC so timestamps read the same for everyone; the browser's own zone is folded into the list.
let cachedZoneOptions: { value: string; label: string }[] | null = null;
function getZoneOptions() {
  if (cachedZoneOptions) return cachedZoneOptions;
  const zones = Array.from(new Set([DEFAULT_TIME_ZONE, ...COMMON_TIME_ZONES, browserTimeZone()]))
    .sort((a, b) => a.localeCompare(b));
  cachedZoneOptions = zones.map((zone) => {
    const offset = timeZoneOffsetLabel(zone);
    return { value: zone, label: offset ? `${zone} · ${offset}` : zone };
  });
  return cachedZoneOptions;
}

function formatDate(value: string) {
  return formatDateTime(value, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

export function AccountDetailsSection({
  user,
  account,
  pending,
  displayName,
  zonePref,
  onZoneChange,
}: {
  user: AuthSessionUser | null;
  account: AccountSettings | null;
  /** Render chrome with skeletons in place of content, so the card doesn't reflow when data lands. */
  pending: boolean;
  displayName: string;
  zonePref: string | null;
  onZoneChange: (zone: string) => void;
}) {
  // Built once - a fresh array each render gave Select a new `options` identity, re-firing its highlight/measure effects and jittering the open panel.
  const zoneOpts = getZoneOptions();

  return (
    <SectionCard
      title="Details"
    >
      <div className="space-y-4 p-5">
        <DetailGroup caption="Profile">
          <DetailRow label="Name" loading={pending} skeletonWidth={140}>
            {displayName}
          </DetailRow>
          <DetailRow label="Email" loading={pending} skeletonWidth={170}>
            {user?.email ? (
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <Mail size={13} className="shrink-0 text-ui-subtle" />
                <span className="truncate">{user.email}</span>
              </span>
            ) : (
              <span className="font-normal text-ui-subtle">Not provided</span>
            )}
          </DetailRow>
        </DetailGroup>

        <DetailGroup caption="GitHub">
          <DetailRow label="GitHub username" loading={pending} skeletonWidth={120}>
            @{user?.login}
          </DetailRow>
          <DetailRow label="GitHub user ID" mono loading={pending} skeletonWidth={80}>
            {user?.githubUserId}
          </DetailRow>
        </DetailGroup>

        <DetailGroup caption="Codra account">
          {(pending || account) && (
            <DetailRow label="Account ID" mono loading={pending} skeletonWidth={230}>
              <RevealOnClick label="account ID">{account?.id}</RevealOnClick>
            </DetailRow>
          )}
          <DetailRow label="Signed in" mono loading={pending} skeletonWidth={190}>
            {user ? formatDate(user.signedInAt) : null}
          </DetailRow>

          {/* Timestamps are stored absolute (UTC); this only controls how they're rendered. */}
          <div className="flex items-center justify-between gap-4 px-4 py-3">
            <span className="min-w-0 shrink-0">
              <Text variant="body" size="sm" bold as="span" className="text-[13px] dark:text-ui-subtle">
                Date &amp; time zone
              </Text>
              <span className="mt-0.5 block text-[11px] leading-tight text-ui-subtle">
                Stored in UTC, shown in {resolvedTimeZone()}
              </span>
            </span>
            {pending ? (
              <Skeleton height={32} width={200} borderRadius={7} />
            ) : (
              <div className="w-full max-w-[15rem]">
                <Select
                  value={zonePref ?? DEFAULT_TIME_ZONE}
                  onValueChange={onZoneChange}
                  options={zoneOpts}
                  variant="card"
                  triggerClassName="h-8 px-2.5 text-[13px]"
                />
              </div>
            )}
          </div>
        </DetailGroup>
      </div>
    </SectionCard>
  );
}
