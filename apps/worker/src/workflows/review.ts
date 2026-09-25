import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import type { AppBindings } from "../env";
import { type ReviewJobMessage } from "@codraoss/schema";
import { runWithDb } from "@codraoss/db/client";
import { CloudflareOrchestrator } from "../ports/cloudflare-orchestrator";

export class ReviewWorkflow extends WorkflowEntrypoint<
  AppBindings,
  ReviewJobMessage
> {
  async run(event: WorkflowEvent<ReviewJobMessage>, step: WorkflowStep) {
    // One DB client for the whole invocation, instead of a Hyperdrive connection per query; a replay after step.sleep just runs this again for the new invocation.
    return runWithDb(this.env, () => this.execute(event, step));
  }

  private async execute(
    event: WorkflowEvent<ReviewJobMessage>,
    step: WorkflowStep,
  ) {
    const orchestrator = new CloudflareOrchestrator(
      this.env.REVIEW_WORKFLOW,
      this.env,
    );
    await orchestrator.executeSteps(event, step);
  }
}
