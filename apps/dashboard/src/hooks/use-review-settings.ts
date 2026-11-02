import { useState } from "react";
import { toast } from "sonner";
import { api } from "@client/lib/api";
import type { ReviewSettings } from "@codraoss/schema";
import { reviewMaxFilesRange } from "@codraoss/schema/review-limits";
import {
  CONCURRENCY_LEVEL_LABEL,
  CONCURRENCY_MAX_VALUE,
  CONCURRENCY_VALUE_TO_LEVEL,
  MAX_COMMENTS_CEILING,
} from "@client/components/features/settings/settings-support";

// Does NOT fetch: SettingsPage loads all settings payloads in one Promise.all and calls `hydrate`
// with the result, so splitting this out did not turn one batched load into two. `setSaving` /
// `setError` are passed in because the page shares one saving/error state across both halves.
export function useReviewSettings({
  setSaving,
  setError,
}: {
  setSaving: (value: string | null) => void;
  setError: (value: string | null) => void;
}) {
  const [reviewSettings, setReviewSettings] = useState<ReviewSettings | null>(
    null,
  );
  const [savedReviewSettings, setSavedReviewSettings] =
    useState<ReviewSettings | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<{
    field: "concurrency" | "comments";
    value: number;
  } | null>(null);
  // Held as a string so the field can be mid-edit (empty, "2" on the way to "200") without the
  // saved value flickering underneath the cursor.
  const [maxFilesDraft, setMaxFilesDraft] = useState("");

  const hydrate = (settings: ReviewSettings) => {
    setReviewSettings(settings);
    setSavedReviewSettings(settings);
    setMaxFilesDraft(String(settings.maxFiles));
  };

  const persistReviewSettings = async (
    next: ReviewSettings,
    summary: string,
  ) => {
    setReviewSettings(next);
    setSaving("review-settings");
    setError(null);
    const tid = toast.loading("Saving…");
    try {
      await api.updateReviewSettings(next);
      setSavedReviewSettings(next);
      toast.success(summary, { id: tid });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Update failed";
      setReviewSettings(savedReviewSettings);
      setError(msg);
      toast.error("Could not save settings", { id: tid, description: msg });
    } finally {
      setSaving(null);
    }
  };

  const handleConcurrencyChange = (value: number) => {
    if (!reviewSettings) return;
    if (
      value === CONCURRENCY_MAX_VALUE &&
      reviewSettings.concurrencyLevel !== "max"
    ) {
      setPendingConfirm({ field: "concurrency", value });
      return;
    }
    const level = CONCURRENCY_VALUE_TO_LEVEL[value];
    void persistReviewSettings(
      { ...reviewSettings, concurrencyLevel: level },
      `Concurrency set to ${CONCURRENCY_LEVEL_LABEL[level]}`,
    );
  };

  const commitMaxFiles = () => {
    if (!reviewSettings) return;
    const parsed = Number.parseInt(maxFilesDraft, 10);

    // Snap junk or out-of-range input back to something valid instead of rejecting it.
    const next = Number.isFinite(parsed)
      ? Math.min(
          reviewMaxFilesRange.max,
          Math.max(reviewMaxFilesRange.min, parsed),
        )
      : reviewSettings.maxFiles;

    setMaxFilesDraft(String(next));
    if (next === reviewSettings.maxFiles) return;
    void persistReviewSettings(
      { ...reviewSettings, maxFiles: next },
      `File limit set to ${next}`,
    );
  };

  const handleCommentsChange = (value: number) => {
    if (!reviewSettings) return;
    if (
      value === MAX_COMMENTS_CEILING &&
      reviewSettings.maxComments !== MAX_COMMENTS_CEILING
    ) {
      setPendingConfirm({ field: "comments", value });
      return;
    }
    void persistReviewSettings(
      {
        ...reviewSettings,
        maxComments: value as ReviewSettings["maxComments"],
      },
      `Comment limit set to ${value}`,
    );
  };

  const applyPendingConfirm = () => {
    if (!pendingConfirm || !reviewSettings) return;
    if (pendingConfirm.field === "concurrency") {
      const level = CONCURRENCY_VALUE_TO_LEVEL[pendingConfirm.value];
      void persistReviewSettings(
        { ...reviewSettings, concurrencyLevel: level },
        `Concurrency set to ${CONCURRENCY_LEVEL_LABEL[level]}`,
      );
    } else {
      void persistReviewSettings(
        {
          ...reviewSettings,
          maxComments: pendingConfirm.value as ReviewSettings["maxComments"],
        },
        `Comment limit set to ${pendingConfirm.value}`,
      );
    }
  };

  return {
    reviewSettings,
    maxFilesDraft,
    setMaxFilesDraft,
    pendingConfirm,
    setPendingConfirm,
    hydrate,
    handleConcurrencyChange,
    handleCommentsChange,
    commitMaxFiles,
    applyPendingConfirm,
  };
}
