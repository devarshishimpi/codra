import { Button, Input } from "@codraoss/ui";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Check, Mail } from "lucide-react";
import { api } from "@client/lib/api";
import type { UpdatesEmailResponse } from "@codraoss/schema/api";

export function UpdatesEmailPrompt() {
  const [status, setStatus] = useState<UpdatesEmailResponse | null>(null);
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .getUpdatesEmailStatus()
      .then((response) => {
        if (!cancelled) setStatus(response);
      })
      .catch(() => {
        if (!cancelled) setStatus(null);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (status?.status !== "pending") return null;

  const subscribe = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);

    try {
      const response = await api.subscribeUpdates(email);
      setStatus(response);
      toast.success("You’re subscribed", {
        description:
          "We’ll only reach out for important releases and security notices.",
      });
    } catch (error) {
      toast.error("Subscription failed", {
        description:
          "We couldn’t save your email. Please check it and try again.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="ui-font-sans rounded-lg border border-ui-line bg-white p-3.5 dark:border-[oklch(0.27_0_0)] dark:bg-black sm:p-4">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between md:gap-6">
        <div className="flex min-w-0 items-start gap-3">
          <span className="ui-well hidden h-9 w-9 shrink-0 items-center justify-center rounded-md text-ui-default sm:flex">
            <Mail size={15} strokeWidth={2} />
          </span>
          <div className="min-w-0">
            <h2 className="text-[13px] font-medium text-ui-default">
              Get important Codra updates
            </h2>
            <p className="mt-0.5 text-xs leading-relaxed text-ui-subtle">
              Get release notes, security fixes, and upgrade heads-ups by email.
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-ui-subtle">
              Opt out anytime. No{"\u00A0"}spam.
            </p>
          </div>
        </div>

        <form
          onSubmit={subscribe}
          className="flex w-full min-w-0 flex-col gap-2 sm:flex-row sm:items-center md:w-auto md:shrink-0 md:basis-[26rem]"
        >
          <Input
            type="email"
            required
            size="sm"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            className="min-w-0 px-3 sm:flex-1"
            aria-label="Email for Codra release updates"
          />
          <Button
            type="submit"
            variant="primary"
            size="sm"
            loading={submitting}
            icon={<Check size={13} />}
            className="w-full sm:w-auto sm:shrink-0"
          >
            Save email
          </Button>
        </form>
      </div>
    </section>
  );
}

// Trigger HMR
