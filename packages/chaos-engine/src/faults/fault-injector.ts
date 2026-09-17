import type { FaultSchedule } from '../types.js';

export class FaultInjector {
  static isActive(schedule: FaultSchedule, currentVirtualTimeUs: number): boolean {
    const start = schedule.startVirtualTimeUs;
    const end = start + schedule.durationVirtualTimeUs;
    return currentVirtualTimeUs >= start && currentVirtualTimeUs < end;
  }

  static evaluateCall(
    schedule: FaultSchedule,
    nodeId: string,
    currentVirtualTimeUs: number,
    baseLatencyUs: number,
  ): {
    latencyUs: number;
    failed: boolean;
    circuitTripped: boolean;
    degraded: boolean;
  } {
    if (schedule.targetNodeId !== nodeId || !this.isActive(schedule, currentVirtualTimeUs)) {
      return {
        latencyUs: baseLatencyUs,
        failed: false,
        circuitTripped: false,
        degraded: false,
      };
    }

    switch (schedule.type) {
      case 'LATENCY_INJECTION': {
        const added = schedule.parameters.addedLatencyUs ?? 100000;
        return {
          latencyUs: baseLatencyUs + added,
          failed: false,
          circuitTripped: false,
          degraded: true,
        };
      }

      case 'ERROR_INJECTION': {
        const errorRate = schedule.parameters.errorRate ?? 0.5;
        const failed = Math.random() < errorRate;
        return {
          latencyUs: baseLatencyUs,
          failed,
          circuitTripped: false,
          degraded: failed,
        };
      }

      case 'CIRCUIT_BREAKER_TRIP': {
        return {
          latencyUs: baseLatencyUs,
          failed: true,
          circuitTripped: true,
          degraded: true,
        };
      }

      case 'BLACKHOLE': {
        // High latency timeout + failure
        return {
          latencyUs: baseLatencyUs + 5000000,
          failed: true,
          circuitTripped: false,
          degraded: true,
        };
      }

      case 'RESOURCE_STARVATION': {
        return {
          latencyUs: baseLatencyUs * 4,
          failed: false,
          circuitTripped: false,
          degraded: true,
        };
      }

      default:
        return {
          latencyUs: baseLatencyUs,
          failed: false,
          circuitTripped: false,
          degraded: false,
        };
    }
  }
}
