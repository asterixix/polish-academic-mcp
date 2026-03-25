import { Agent } from "agents";
import type { Env } from "../types.js";

type PipelineAgentState = {
  // Keep minimal state; workflow persists its own durable step state.
};

/**
 * Durable Object backing the pipeline workflow.
 *
 * The workflow uses `waitForApproval()`, which is unblocked by calling
 * `approveWorkflow()` / `rejectWorkflow()` on the same agent instance.
 */
export class PipelineAgent extends Agent<Env, PipelineAgentState> {
  initialState: PipelineAgentState = {};
}

