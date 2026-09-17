import type { DependencyMode } from '@blackbox-x/contracts';

export interface OperationDependencyCall {
  edgeId: string;
  targetOperationName?: string;
  callOrder: number;
  mode: DependencyMode;
  required: boolean;
}

export interface OperationResourceProfile {
  cpuWeight: number;
  memoryBytes: number;
  connectionSlots: number;
}

export interface OperationPolicy {
  maxAttempts: number;
  backoffMs: number;
  retryBudgetPercent: number;
  circuitBreakerEnabled: boolean;
  timeoutMs: number;
}

export class OperationEntity {
  constructor(
    public readonly id: string,
    public readonly nodeId: string,
    public readonly name: string,
    public readonly method: string = 'GET',
    public readonly path: string = '/',
    public readonly timeoutMs: number = 2000,
    public readonly concurrencyLimit: number = 100,
    public readonly serviceTimeDistribution: string = 'lognormal',
    public readonly serviceTimeParams: Record<string, unknown> = { p50: 30, p99: 150 },
    public readonly dependencyCalls: OperationDependencyCall[] = [],
    public readonly policy?: OperationPolicy,
    public readonly resourceProfile?: OperationResourceProfile,
  ) {}

  public addDependencyCall(call: OperationDependencyCall): void {
    this.dependencyCalls.push(call);
    this.dependencyCalls.sort((a, b) => a.callOrder - b.callOrder);
  }
}
