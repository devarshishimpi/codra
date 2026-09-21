import { Badge, Button, GithubMark, Input, LinkButton, Skeleton } from '@codraoss/ui';
import { useState } from 'react';
import { toast } from 'sonner';
import { api } from '@client/lib/api';
import { ExternalLink, Pencil, Check, X } from 'lucide-react';
import type { AccountSettings, AuthSessionUser } from '@codraoss/schema/api';

export function ProfileCard({
  user,
  pending,
  displayName,
  initial,
  profileUrl,
  onAccountChange,
}: {
  user: AuthSessionUser | null;
  /** Render chrome with skeletons in place of content, so the card doesn't reflow when data lands. */
  pending: boolean;
  displayName: string;
  initial: string;
  profileUrl: string;
  onAccountChange: (account: AccountSettings) => void;
}) {
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [savingName, setSavingName] = useState(false);

  const startEditName = () => {
    setNameDraft(displayName);
    setEditingName(true);
  };

  const saveName = async () => {
    const trimmed = nameDraft.trim();
    if (!trimmed) {
      toast.error('Name cannot be empty.');
      return;
    }
    setSavingName(true);
    try {
      const res = await api.updateAccountName(trimmed);
      onAccountChange(res.account);
      setEditingName(false);
      toast.success('Account name updated');
    } catch (e) {
      toast.error('Could not update name', {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setSavingName(false);
    }
  };

  return (
    <section className="ui-panel min-w-0 overflow-hidden">
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:gap-5 sm:p-6">
        {pending ? (
          <Skeleton width={56} height={56} className="shrink-0 rounded-full" />
        ) : user!.avatarUrl ? (
          <img
            src={`${user!.avatarUrl}${user!.avatarUrl.includes('?') ? '&' : '?'}s=112`}
            alt=""
            width={56}
            height={56}
            className="h-14 w-14 shrink-0 rounded-full object-cover ring-1 ring-ui-line"
          />
        ) : (
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-ui-fill text-xl font-semibold text-ui-strong ring-1 ring-ui-line">
            {initial}
          </span>
        )}

        <div className="min-w-0 flex-1">
          {pending ? (
            <div className="space-y-2.5">
              <Skeleton height={17} width={190} borderRadius={5} />
              <Skeleton height={12} width={120} borderRadius={4} />
            </div>
          ) : editingName ? (
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void saveName();
                    if (e.key === 'Escape') setEditingName(false);
                  }}
                  autoFocus
                  maxLength={120}
                  aria-label="Account name"
                  className="h-9 w-full max-w-xs"
                />
                <div className="flex items-center gap-1.5">
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={saveName}
                    loading={savingName}
                    icon={<Check size={13} />}
                  >
                    Save
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setEditingName(false)}
                    disabled={savingName}
                    icon={<X size={13} />}
                    className="text-ui-subtle hover:text-ui-default"
                  >
                    Cancel
                  </Button>
                </div>
              </div>
              <p className="mt-2 text-[11px] text-ui-subtle">
                Enter to save · Esc to cancel - this name is used across Codra.
              </p>
            </div>
          ) : (
            <>
              <div className="group/name flex min-w-0 items-center gap-1.5">
                <h2
                  className="truncate text-lg font-bold text-ui-strong"
                  style={{ letterSpacing: '-0.01em' }}
                >
                  {displayName}
                </h2>
                <button
                  type="button"
                  onClick={startEditName}
                  aria-label="Edit account name"
                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ui-subtle transition-colors hover:bg-ui-fill hover:text-ui-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Pencil size={13} />
                </button>
              </div>
              <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
                <span className="truncate text-[13px] text-ui-default dark:text-ui-subtle">
                  @{user!.login}
                </span>
                <Badge variant="secondary" className="shrink-0 gap-1.5">
                  <GithubMark size={11} />
                  GitHub
                </Badge>
              </div>
            </>
          )}
        </div>

        {pending ? (
          <Skeleton width={148} height={32} borderRadius={6} className="shrink-0" />
        ) : (
          <LinkButton
            href={profileUrl}
            external
            variant="secondary"
            size="sm"
            icon={<GithubMark size={14} />}
            className="shrink-0 self-start sm:self-auto"
          >
            View on GitHub
            <ExternalLink size={12} className="text-ui-subtle" />
          </LinkButton>
        )}
      </div>
    </section>
  );
}
