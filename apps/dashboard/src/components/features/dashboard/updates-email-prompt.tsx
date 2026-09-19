import { Button, Input } from '@codraoss/ui';
import { useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Check, Mail } from 'lucide-react';
import { api } from '@client/lib/api';

function PromptToast({ onDismiss }: { onDismiss: () => void }) {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const subscribe = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);

    try {
      await api.subscribeUpdates(email);
      onDismiss();
      toast.success('You’re subscribed', {
        description: 'We’ll only reach out for important releases and security notices.',
      });
    } catch (error) {
      toast.error('Subscription failed', {
        description: 'We couldn’t save your email. Please check it and try again.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 w-full ui-font-sans p-1">
      <div className="flex min-w-0 items-start gap-3">
        <span className="ui-well flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-ui-default">
          <Mail size={14} strokeWidth={2} />
        </span>
        <div className="min-w-0">
          <h2 className="text-[13px] font-medium text-ui-default">Codra updates</h2>
          <p className="mt-0.5 text-xs leading-relaxed text-ui-subtle">
            Release notes & security fixes.
          </p>
        </div>
      </div>
      <form onSubmit={subscribe} className="flex w-full min-w-0 flex-col gap-2">
        <Input
          type="email"
          required
          size="sm"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          className="min-w-0 w-full px-3"
          aria-label="Email for Codra release updates"
        />
        <Button
          type="submit"
          variant="primary"
          size="sm"
          loading={submitting}
          icon={<Check size={13} />}
          className="w-full"
        >
          Save email
        </Button>
      </form>
    </div>
  );
}

export function UpdatesEmailPrompt() {
  useEffect(() => {
    let cancelled = false;
    api.getUpdatesEmailStatus()
      .then((response) => {
        if (!cancelled && response.status === 'pending') {
          toast.custom(() => <PromptToast onDismiss={() => toast.dismiss('email-prompt')} />, {
            id: 'email-prompt',
            duration: Infinity,
          });
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      toast.dismiss('email-prompt');
    };
  }, []);

  return null;
}
