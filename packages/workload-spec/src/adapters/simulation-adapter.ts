import { SubStream, deriveStreamSeed } from '@blackbox-x/statistics';
import {
  WorkloadSpecDefinition,
  RequestMixItem,
  normalizeRequestMix,
  ConstantArrivalParams,
  PoissonArrivalParams,
  RampArrivalParams,
  BurstArrivalParams,
} from '../patterns/types.js';

export interface VirtualArrivalEvent {
  eventId: string;
  virtualTimeUs: number;
  operationName: string;
  targetNodeId?: string;
}

export class SimulationWorkloadAdapter {
  readonly spec: WorkloadSpecDefinition;
  readonly normalizedMix: RequestMixItem[];
  private readonly substream: SubStream;
  private readonly cumulativeMix: { operationName: string; threshold: number; targetNodeId?: string }[];

  constructor(spec: WorkloadSpecDefinition, rootSeed: bigint = 42n) {
    this.spec = spec;
    this.normalizedMix = normalizeRequestMix(spec.requestMix);

    const streamSeed = spec.seed ?? deriveStreamSeed(rootSeed, `workload:${spec.id}`);
    this.substream = new SubStream(`workload:${spec.id}`, streamSeed);

    let runningSum = 0;
    this.cumulativeMix = this.normalizedMix.map((item) => {
      runningSum += item.weight;
      return {
        operationName: item.operationName,
        threshold: runningSum,
        targetNodeId: item.targetNodeId,
      };
    });
    // Ensure the last threshold is exactly 1.0 to handle small floating point inaccuracies
    if (this.cumulativeMix.length > 0) {
      this.cumulativeMix[this.cumulativeMix.length - 1].threshold = 1.0;
    }
  }

  /**
   * Samples an operation name from the normalized request mix.
   */
  selectOperation(): { operationName: string; targetNodeId?: string } {
    const draw = this.substream.nextFloat01();
    for (const item of this.cumulativeMix) {
      if (draw <= item.threshold) {
        return { operationName: item.operationName, targetNodeId: item.targetNodeId };
      }
    }
    const fallback = this.cumulativeMix[this.cumulativeMix.length - 1];
    return { operationName: fallback.operationName, targetNodeId: fallback.targetNodeId };
  }

  /**
   * Returns the instantaneous expected arrival rate (RPS) at a given virtual timestamp.
   */
  getInstantaneousRateAt(virtualTimeUs: number): number {
    const virtualTimeSec = virtualTimeUs / 1_000_000;

    switch (this.spec.arrivalPattern) {
      case 'CONSTANT': {
        const params = this.spec.arrivalParams as ConstantArrivalParams;
        return params.rateRps;
      }
      case 'POISSON': {
        const params = this.spec.arrivalParams as PoissonArrivalParams;
        return params.lambdaRps;
      }
      case 'RAMP': {
        const params = this.spec.arrivalParams as RampArrivalParams;
        if (virtualTimeSec >= params.rampDurationSeconds) {
          return params.targetRateRps;
        }
        const fraction = virtualTimeSec / params.rampDurationSeconds;
        return params.initialRateRps + (params.targetRateRps - params.initialRateRps) * fraction;
      }
      case 'BURST': {
        const params = this.spec.arrivalParams as BurstArrivalParams;
        const cycleSec = params.baselineDurationSeconds + params.burstDurationSeconds;
        const offsetSec = virtualTimeSec % cycleSec;
        if (offsetSec < params.baselineDurationSeconds) {
          return params.baselineRateRps;
        }
        return params.burstRateRps;
      }
      default:
        throw new Error(`Unsupported pattern: ${this.spec.arrivalPattern}`);
    }
  }

  /**
   * Generates a batch of arrival events up to total duration or maxEvents limit.
   */
  generateArrivals(maxEvents?: number): VirtualArrivalEvent[] {
    const events: VirtualArrivalEvent[] = [];
    const maxTimeUs = this.spec.totalDurationSeconds * 1_000_000;
    let currentVirtualTimeUs = 0;
    let count = 0;

    while (currentVirtualTimeUs < maxTimeUs) {
      if (maxEvents !== undefined && count >= maxEvents) {
        break;
      }

      const rate = Math.max(1e-6, this.getInstantaneousRateAt(currentVirtualTimeUs));
      let interArrivalUs: number;

      if (this.spec.arrivalPattern === 'CONSTANT') {
        interArrivalUs = Math.max(1, Math.round(1_000_000 / rate));
      } else {
        // Stochastic exponential inter-arrival for Poisson, Ramp, and Burst
        interArrivalUs = this.substream.nextExponentialUs(rate);
      }

      currentVirtualTimeUs += interArrivalUs;
      if (currentVirtualTimeUs >= maxTimeUs) {
        break;
      }

      const selected = this.selectOperation();
      count++;
      events.push({
        eventId: `arr_${this.spec.id}_${count}`,
        virtualTimeUs: currentVirtualTimeUs,
        operationName: selected.operationName,
        targetNodeId: selected.targetNodeId,
      });
    }

    return events;
  }
}
