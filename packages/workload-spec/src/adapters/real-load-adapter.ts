import {
  WorkloadSpecDefinition,
  RequestMixItem,
  normalizeRequestMix,
  ConstantArrivalParams,
  PoissonArrivalParams,
  RampArrivalParams,
  BurstArrivalParams,
} from '../patterns/types.js';

export interface K6Stage {
  duration: string;
  target: number;
}

export interface K6ScenarioConfig {
  executor: string;
  stages?: K6Stage[];
  rate?: number;
  timeUnit?: string;
  duration?: string;
}

export interface AutocannonLoadProfile {
  duration: number;
  overallRate: number;
  pipelining: number;
  connections: number;
  requests: { name: string; weight: number }[];
}

export class RealLoadWorkloadAdapter {
  readonly spec: WorkloadSpecDefinition;
  readonly normalizedMix: RequestMixItem[];

  constructor(spec: WorkloadSpecDefinition) {
    this.spec = spec;
    this.normalizedMix = normalizeRequestMix(spec.requestMix);
  }

  /**
   * Compiles the arrival specification into k6 execution stages.
   */
  toK6Stages(): K6Stage[] {
    switch (this.spec.arrivalPattern) {
      case 'CONSTANT': {
        const params = this.spec.arrivalParams as ConstantArrivalParams;
        return [{ duration: `${this.spec.totalDurationSeconds}s`, target: params.rateRps }];
      }
      case 'POISSON': {
        const params = this.spec.arrivalParams as PoissonArrivalParams;
        return [{ duration: `${this.spec.totalDurationSeconds}s`, target: params.lambdaRps }];
      }
      case 'RAMP': {
        const params = this.spec.arrivalParams as RampArrivalParams;
        const stages: K6Stage[] = [
          { duration: `${params.rampDurationSeconds}s`, target: params.targetRateRps },
        ];
        const remaining = this.spec.totalDurationSeconds - params.rampDurationSeconds;
        if (remaining > 0) {
          stages.push({ duration: `${remaining}s`, target: params.targetRateRps });
        }
        return stages;
      }
      case 'BURST': {
        const params = this.spec.arrivalParams as BurstArrivalParams;
        const stages: K6Stage[] = [];
        let elapsed = 0;
        while (elapsed < this.spec.totalDurationSeconds) {
          const baseDur = Math.min(params.baselineDurationSeconds, this.spec.totalDurationSeconds - elapsed);
          stages.push({ duration: `${baseDur}s`, target: params.baselineRateRps });
          elapsed += baseDur;
          if (elapsed >= this.spec.totalDurationSeconds) break;

          const burstDur = Math.min(params.burstDurationSeconds, this.spec.totalDurationSeconds - elapsed);
          stages.push({ duration: `${burstDur}s`, target: params.burstRateRps });
          elapsed += burstDur;
        }
        return stages;
      }
      default:
        throw new Error(`Unsupported arrival pattern: ${this.spec.arrivalPattern}`);
    }
  }

  /**
   * Compiles the workload specification into an Autocannon execution profile.
   */
  toAutocannonConfig(options: { connections?: number; pipelining?: number } = {}): AutocannonLoadProfile {
    let overallRate = 100;
    if (this.spec.arrivalPattern === 'CONSTANT') {
      overallRate = (this.spec.arrivalParams as ConstantArrivalParams).rateRps;
    } else if (this.spec.arrivalPattern === 'POISSON') {
      overallRate = (this.spec.arrivalParams as PoissonArrivalParams).lambdaRps;
    } else if (this.spec.arrivalPattern === 'RAMP') {
      overallRate = (this.spec.arrivalParams as RampArrivalParams).targetRateRps;
    } else if (this.spec.arrivalPattern === 'BURST') {
      overallRate = (this.spec.arrivalParams as BurstArrivalParams).burstRateRps;
    }

    return {
      duration: this.spec.totalDurationSeconds,
      overallRate,
      connections: options.connections ?? 10,
      pipelining: options.pipelining ?? 1,
      requests: this.normalizedMix.map((item) => ({
        name: item.operationName,
        weight: item.weight,
      })),
    };
  }

  /**
   * Generates a high-level summary of the compiled load configuration.
   */
  getSummary() {
    return {
      workloadId: this.spec.id,
      arrivalPattern: this.spec.arrivalPattern,
      durationSeconds: this.spec.totalDurationSeconds,
      requestMix: this.normalizedMix,
      k6Stages: this.toK6Stages(),
    };
  }
}
