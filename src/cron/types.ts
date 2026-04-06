export type CronSchedule =
  | { type: "at"; timestamp: number }
  | { type: "every"; intervalMs: number }
  | { type: "cron"; expression: string; tz?: string };

export type CronPayload =
  | { kind: "systemEvent"; text: string }
  | { kind: "agentTurn"; message: string; model?: string };

export type CronDelivery = {
  channelId: string;
  mentionUser?: string;
};

export type CronRunStatus = "ok" | "error" | "skipped";

export type CronJob = {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  deleteAfterRun?: boolean;
  schedule: CronSchedule;
  payload: CronPayload;
  delivery?: CronDelivery;
  state: {
    nextRunAtMs?: number;
    lastRunAtMs?: number;
    lastRunStatus?: CronRunStatus;
    lastError?: string;
    consecutiveErrors?: number;
  };
  createdAt: number;
  updatedAt: number;
};

export type CronJobCreate = Omit<
  CronJob,
  "id" | "state" | "createdAt" | "updatedAt"
> & {
  id?: string;
};

export type CronJobPatch = Partial<
  Pick<
    CronJob,
    | "name"
    | "description"
    | "enabled"
    | "schedule"
    | "payload"
    | "delivery"
    | "deleteAfterRun"
  >
>;

export type CronRunEntry = {
  jobId: string;
  startedAt: number;
  completedAt: number;
  status: CronRunStatus;
  result?: string;
  error?: string;
};

export type CronStoreData = {
  version: 1;
  jobs: CronJob[];
};
