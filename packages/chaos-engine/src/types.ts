export type FaultType =
  | 'LATENCY_INJECTION'
  | 'ERROR_INJECTION'
  | 'CIRCUIT_BREAKER_TRIP'
  | 'BLACKHOLE'
  | 'RESOURCE_STARVATION';

export interface FaultSchedule {
  id: string;
  type: FaultType;
  targetNodeId: string;
  targetEdgeId?: string;
  startVirtualTimeUs: number;
  durationVirtualTimeUs: number;
  parameters: {
    addedLatencyUs?: number;
    errorRate?: number;
    dropConnections?: boolean;
    throttleCpuCores?: number;
  };
}

export interface ResilienceMetrics {
  resilienceScore: number;
  blastRadius: number;
  mttrMs: number;
  cascadeDetected: boolean;
  totalRequests: number;
  failedRequests: number;
  degradedRequests: number;
  fallbackRequests: number;
}

export interface ChaosExperimentResult {
  experimentId: string;
  faultType: FaultType;
  targetNodeId: string;
  baselineMetrics: {
    throughputRps: number;
    p99Us: number;
    errorRate: number;
  };
  chaosMetrics: {
    throughputRps: number;
    p99Us: number;
    errorRate: number;
  };
  resilience: ResilienceMetrics;
}
