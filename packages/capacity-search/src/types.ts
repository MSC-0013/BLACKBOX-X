export interface SloConstraint {
  maxP99Us: number;
  maxErrorRate: number; // e.g. 0.01 for 1%
}

export interface CapacitySearchStep {
  stepIndex: number;
  candidateRps: number;
  p99Us: number;
  errorRate: number;
  satisfiesSlo: boolean;
}

export interface KneePointResult {
  kneeRps: number;
  curvature: number;
  latencyAtKneeUs: number;
}

export interface BottleneckAttribution {
  limitingComponent: string;
  limitingResourceType: 'CPU' | 'THREADPOOL' | 'CONNECTION_POOL';
  utilization: number;
  recommendation: string;
}

export interface CapacitySearchResult {
  maxSustainableRps: number;
  kneePoint?: KneePointResult;
  bottleneck?: BottleneckAttribution;
  steps: CapacitySearchStep[];
  sloSatisfied: boolean;
}
