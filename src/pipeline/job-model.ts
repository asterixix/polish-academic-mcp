export type PipelineJobStatus =
  | "created"
  | "running"
  | "waiting_approval"
  | "completed"
  | "failed";

export interface PipelineJobContext {
  /**
   * Stable identifier for correlating multi-step pipeline logs and outputs.
   * If omitted, tools will generate a fresh value.
   */
  job_id: string;
  /**
   * Identifier for correlating a single pipeline execution within the job.
   * If omitted, tools will generate a fresh value.
   */
  run_id: string;
  created_at: string;
}

export function createJobContext(input?: {
  job_id?: string;
  run_id?: string;
}): PipelineJobContext {
  const job_id =
    input?.job_id && input.job_id.trim().length > 0 ? input.job_id : crypto.randomUUID();
  const run_id =
    input?.run_id && input.run_id.trim().length > 0 ? input.run_id : crypto.randomUUID();
  return {
    job_id,
    run_id,
    created_at: new Date().toISOString(),
  };
}

export function compactIsoNow(): string {
  return new Date().toISOString();
}

