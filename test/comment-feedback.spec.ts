import { describe, expect, it } from "vitest";
import { createApiRouter } from "@codraoss/api";
import { createTestEnv } from "./helpers";
import {
  FormatterService,
  formatFindingMarker,
  parseFindingMarker,
} from "@codraoss/core/formatter";
import type { ParsedReviewComment } from "@codraoss/schema";

import { signPayload } from "./mocks/fixtures";

const comment = (
  over: Partial<ParsedReviewComment> = {},
): ParsedReviewComment => ({
  path: "a.ts",
  line: 1,
  position: 1,
  severity: "P1",
  category: "quality",
  title: "Unvalidated input",
  body: "The value is never checked.",
  fingerprint: "deadbeef",
  anchorHash: "cafe1234",
  ...over,
});

describe("finding marker", () => {
  it("round-trips through a rendered comment body", () => {
    const body = new FormatterService("https://codra.test").formatInlineComment(
      comment({ fingerprintV2: "beefcafe" }),
    );
    expect(parseFindingMarker(body)).toEqual({
      fingerprint: "deadbeef",
      anchorHash: "cafe1234",
      fingerprintV2: "beefcafe",
    });
  });

  // Every comment already on GitHub carries the two-field form. If this stopped parsing, deletions of
  // all historical comments would silently stop being recorded -- parseFindingMarker returns null and
  // the webhook records zero, with nothing to indicate anything is wrong.
  it("still parses the two-field marker written before v2 existed", () => {
    expect(
      parseFindingMarker("Body\n\n<!-- codra-fp:deadbeef:cafe1234 -->"),
    ).toEqual({
      fingerprint: "deadbeef",
      anchorHash: "cafe1234",
      fingerprintV2: null,
    });
  });

  it("emits nothing when the finding has no fingerprint", () => {
    expect(
      formatFindingMarker({ fingerprint: undefined, anchorHash: undefined }),
    ).toBe("");
  });

  it("returns null for a body written by a human", () => {
    expect(parseFindingMarker("Looks good to me!")).toBeNull();
  });
});

describe("feedback webhooks", () => {
  const env = createTestEnv();
  const app = createApiRouter();

  // Invariant: recording feedback must not call GitHub, since it runs inside the webhook delivery timeout.
  const githubRequests: string[] = [];
  const originalFetch = globalThis.fetch;

  beforeAll(() => {
    globalThis.fetch = ((
      input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (url.includes("github.com")) githubRequests.push(url);
      return originalFetch(input, init);
    }) as typeof fetch;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
    expect(githubRequests).toEqual([]);
  });

  async function post(eventName: string, payload: unknown) {
    const body = JSON.stringify(payload);
    const signature = await signPayload(env.GITHUB_APP_WEBHOOK_SECRET, body);
    (env.REVIEW_QUEUE as any).sent.length = 0;
    const response = await app.request(
      "http://codra.test/webhook",
      {
        method: "POST",
        headers: {
          "x-github-event": eventName,
          "x-github-delivery": `${eventName}-${Date.now()}-${Math.random()}`,
          "x-hub-signature-256": signature,
          "content-type": "application/json",
        },
        body,
      },
      env,
    );
    return { response, json: (await response.json()) as any };
  }

  const basePayload = (over: Record<string, unknown>) => ({
    installation: { id: 123 },
    repository: { name: "feedback-repo", owner: { login: "test-owner" } },
    pull_request: { number: 7 },
    ...over,
  });

  const botComment = (over: Record<string, unknown> = {}) => ({
    id: 900001,
    user: { login: `${env.BOT_USERNAME}[bot]` },
    path: "a.ts",
    // Null on purpose: GitHub nulls `line` once a comment goes outdated, which is exactly when we
    // most want the feedback. The marker is what makes the match possible.
    line: null,
    body: `Something<!-- codra-fp:deadbeef:cafe1234 -->`,
    ...over,
  });

  it("records a deleted bot comment without queueing any review work", async () => {
    const { response, json } = await post(
      "pull_request_review_comment",
      basePayload({
        action: "deleted",
        comment: botComment(),
      }),
    );

    expect(response.status).toBe(202);
    expect(json.feedback).toBe(true);
    expect((env.REVIEW_QUEUE as any).sent).toHaveLength(0);
  });

  // Humans delete each other's comments constantly. Recording those would let one developer's
  // cleanup suppress a finding for the whole repository.
  it("ignores feedback on comments the bot did not write", async () => {
    const { response, json } = await post(
      "pull_request_review_comment",
      basePayload({
        action: "deleted",
        comment: botComment({ user: { login: "some-human" }, id: 900002 }),
      }),
    );

    expect(response.status).toBe(202);
    expect(json.recorded).toBe(0);
  });

  it("ignores bot comments with no finding marker", async () => {
    const { json } = await post(
      "pull_request_review_comment",
      basePayload({
        action: "deleted",
        comment: botComment({ body: "no marker here", id: 900003 }),
      }),
    );

    expect(json.recorded).toBe(0);
  });

  it("accepts resolved review threads without queueing review work", async () => {
    const { response, json } = await post(
      "pull_request_review_thread",
      basePayload({
        action: "resolved",
        thread: { node_id: "PRT_x", comments: [botComment({ id: 900004 })] },
      }),
    );

    expect(response.status).toBe(202);
    expect(json.feedback).toBe(true);
    expect((env.REVIEW_QUEUE as any).sent).toHaveLength(0);
  });
});
