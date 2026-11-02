import { describe, it, expect, vi } from "vitest";
import { GitHubClient } from "@codraoss/provider-github";
import type { ReviewComment } from "@codraoss/core/ports";

// Regression: inline comments silently stopped reaching GitHub because `createReview` kept only
// comments carrying a legacy diff `position` -- a value nothing in the pipeline computes anymore
// (the model reports a file `line`). Every review posted with just the summary body while the
// summary still claimed N findings were shown. The old suite stubbed `createReview` wholesale, so
// nothing inspected the request body.
function clientWithCapturedRequest() {
  const client = new GitHubClient({} as never, "123");
  const sent: { url: string; body: any }[] = [];

  // `request` is the single choke point every GitHub call funnels through.
  vi.spyOn(client as any, "request").mockImplementation(
    async (...args: unknown[]) => {
      const [url, init] = args as [string, RequestInit | undefined];
      sent.push({
        url,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      return new Response(JSON.stringify({ id: 555 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  );

  return { client, sent };
}

const comment = (over: Partial<ReviewComment> = {}): ReviewComment => ({
  path: "src/app.ts",
  line: 12,
  body: "Something is wrong here.",
  ...over,
});

describe("createReview inline comment payload", () => {
  it("sends line-addressed comments through to GitHub", async () => {
    const { client, sent } = clientWithCapturedRequest();

    await client.createReview("o", "r", 7, {
      commitSha: "abc123",
      event: "COMMENT",
      body: "summary",
      comments: [comment(), comment({ path: "src/b.ts", line: 40 })],
    });

    const payload = sent.at(-1)!.body;
    // The regression: this array used to arrive empty.
    expect(payload.comments).toHaveLength(2);
    expect(payload.comments[0]).toMatchObject({
      path: "src/app.ts",
      line: 12,
      side: "RIGHT",
    });
    expect(payload.comments[1]).toMatchObject({
      path: "src/b.ts",
      line: 40,
      side: "RIGHT",
    });
    expect(payload.commit_id).toBe("abc123");
  });

  it("honours an explicit side", async () => {
    const { client, sent } = clientWithCapturedRequest();
    await client.createReview("o", "r", 7, {
      commitSha: "abc123",
      event: "COMMENT",
      body: "summary",
      comments: [comment({ side: "LEFT" })],
    });
    expect(sent.at(-1)!.body.comments[0].side).toBe("LEFT");
  });

  it("still supports legacy position-addressed comments", async () => {
    const { client, sent } = clientWithCapturedRequest();
    await client.createReview("o", "r", 7, {
      commitSha: "abc123",
      event: "COMMENT",
      body: "summary",
      comments: [{ path: "src/app.ts", position: 4, body: "legacy" }],
    });
    const [only] = sent.at(-1)!.body.comments;
    expect(only).toMatchObject({ path: "src/app.ts", position: 4 });
    expect(only.line).toBeUndefined();
  });

  it("drops only the comments that have no usable anchor", async () => {
    const { client, sent } = clientWithCapturedRequest();
    await client.createReview("o", "r", 7, {
      commitSha: "abc123",
      event: "COMMENT",
      body: "summary",
      comments: [
        comment({ line: 3 }),
        { path: "src/x.ts", body: "no anchor at all" },
        { path: "src/y.ts", line: 0, body: "zero is not a line" },
      ],
    });
    const { comments } = sent.at(-1)!.body;
    expect(comments).toHaveLength(1);
    expect(comments[0].line).toBe(3);
  });

  it("keeps the summary body when GitHub rejects the inline comments", async () => {
    const client = new GitHubClient({} as never, "123");
    const sent: any[] = [];
    let call = 0;
    vi.spyOn(client as any, "request").mockImplementation(
      async (...args: unknown[]) => {
        const [, init] = args as [string, RequestInit];
        sent.push(JSON.parse(String(init.body)));
        call += 1;
        // First attempt (with comments) is rejected the way GitHub rejects an
        // out-of-diff line; the retry must still land the summary.
        if (call === 1) {
          return new Response('{"message":"line must be part of the diff"}', {
            status: 422,
          });
        }
        return new Response(JSON.stringify({ id: 777 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    );

    const review = await client.createReview("o", "r", 7, {
      commitSha: "abc123",
      event: "COMMENT",
      body: "summary",
      comments: [comment()],
    });

    expect(review.id).toBe(777);
    expect(sent[0].comments).toHaveLength(1);
    expect(sent[1].comments).toHaveLength(0);
    expect(sent[1].body).toBe("summary");
    // Nothing was actually shown, so nothing may be recorded as posted -- otherwise the finding
    // would be suppressed on every later commit without a human ever having seen it.
    expect(review.postedIndices).toEqual([]);
  });

  it("reports which comments GitHub accepted, by caller index", async () => {
    const client = new GitHubClient({} as never, "123");
    vi.spyOn(client as any, "request").mockResolvedValue(
      new Response(JSON.stringify({ id: 42 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const review = await client.createReview("o", "r", 7, {
      commitSha: "abc123",
      event: "COMMENT",
      body: "summary",
      comments: [
        comment({ line: 3 }),
        // Unaddressable: dropped before the request, so its index must not be reported.
        comment({ line: 0, position: 0 }),
        comment({ line: 9 }),
      ],
    });

    expect(review.postedIndices).toEqual([0, 2]);
  });
});
