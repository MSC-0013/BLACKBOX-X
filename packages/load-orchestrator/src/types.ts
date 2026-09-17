export type LoadCommandType = 'START_LOAD' | 'RAMP_LOAD' | 'STOP_LOAD' | 'STATUS_QUERY';

export interface LoadCommand {
  commandId: string;
  type: LoadCommandType;
  runId: string;
  targetUrl: string;
  targetRps: number;
  durationSec: number;
  pattern: 'CONSTANT' | 'POISSON' | 'RAMP' | 'BURST';
  concurrency: number;
  timestamp: string;
  assignedWorkers?: string[];
}

export type WorkerStatus = 'IDLE' | 'BUSY' | 'STOPPING' | 'OFFLINE';

export interface WorkerRegistration {
  workerId: string;
  hostname: string;
  status: WorkerStatus;
  registeredAt: string;
  heartbeatAt: string;
  activeRunId?: string;
  metadata?: Record<string, unknown>;
}

export interface WorkerTelemetry {
  runId: string;
  workerId: string;
  timestamp: string;
  currentRps: number;
  requests: number;
  successes: number;
  errors: number;
  latenciesUs: number[];
  p50Us?: number;
  p90Us?: number;
  p99Us?: number;
}

export interface AggregatedClusterTelemetry {
  runId: string;
  activeWorkers: number;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  actualRps: number;
  errorRate: number;
  p50Us: number;
  p90Us: number;
  p95Us: number;
  p99Us: number;
  meanUs: number;
}

export interface OrchestratorRunResult {
  runId: string;
  status: 'COMPLETED' | 'FAILED' | 'CANCELLED';
  targetUrl: string;
  targetRps: number;
  durationSec: number;
  allocatedWorkers: number;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  actualRps: number;
  errorRate: number;
  p50Us: number;
  p90Us: number;
  p95Us: number;
  p99Us: number;
  meanUs: number;
  startedAt: string;
  completedAt: string;
}

export interface OrchestratorConfig {
  kafkaBrokers: string[];
  redisUrl: string;
  commandTopic?: string;
  telemetryTopic?: string;
  heartbeatTtlSec?: number;
}
