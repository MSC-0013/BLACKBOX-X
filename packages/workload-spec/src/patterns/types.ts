export type ArrivalPattern = 'CONSTANT' | 'POISSON' | 'RAMP' | 'BURST';

export interface RequestMixItem {
  operationName: string;
  weight: number;
  targetNodeId?: string;
}

export interface ConstantArrivalParams {
  rateRps: number;
}

export interface PoissonArrivalParams {
  lambdaRps: number;
}

export interface RampArrivalParams {
  initialRateRps: number;
  targetRateRps: number;
  rampDurationSeconds: number;
  holdDurationSeconds?: number;
}

export interface BurstArrivalParams {
  baselineRateRps: number;
  burstRateRps: number;
  baselineDurationSeconds: number;
  burstDurationSeconds: number;
  repeatCount?: number;
}

export type ArrivalParams =
  | { pattern: 'CONSTANT'; params: ConstantArrivalParams }
  | { pattern: 'POISSON'; params: PoissonArrivalParams }
  | { pattern: 'RAMP'; params: RampArrivalParams }
  | { pattern: 'BURST'; params: BurstArrivalParams };

export interface WorkloadPhaseSchedule {
  phaseIndex: number;
  pattern: ArrivalPattern;
  durationSeconds: number;
  startRateRps: number;
  endRateRps: number;
}

export interface WorkloadSpecDefinition {
  id: string;
  name: string;
  arrivalPattern: ArrivalPattern;
  arrivalParams: ConstantArrivalParams | PoissonArrivalParams | RampArrivalParams | BurstArrivalParams;
  requestMix: RequestMixItem[];
  totalDurationSeconds: number;
  seed?: bigint;
}

/**
 * Validates and normalizes request mix items such that all weights sum to 1.0.
 */
export function normalizeRequestMix(mix: RequestMixItem[]): RequestMixItem[] {
  if (!mix || mix.length === 0) {
    throw new Error('Request mix must contain at least one operation');
  }

  const sum = mix.reduce((acc, item) => {
    if (item.weight < 0) {
      throw new Error(`Negative weight not allowed for operation ${item.operationName}`);
    }
    return acc + item.weight;
  }, 0);

  if (sum <= 0) {
    throw new Error('Total weight of request mix must be strictly positive');
  }

  return mix.map((item) => ({
    ...item,
    weight: item.weight / sum,
  }));
}
