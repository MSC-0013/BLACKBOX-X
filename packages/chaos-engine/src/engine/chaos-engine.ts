import { FaultInjector } from '../faults/fault-injector.js';
import { CascadeAnalyzer, type GraphEdge } from '../propagation/cascade-analyzer.js';
import { ResilienceEvaluator } from '../metrics/resilience-evaluator.js';
import type { FaultSchedule, ChaosExperimentResult } from '../types.js';

export interface ChaosExperimentConfig {
  experimentId: string;
  schedule: FaultSchedule;
  topologyEdges: GraphEdge[];
  totalRequests: number;
  baseLatencyUs?: number;
}

export class ChaosEngine {
  static runExperiment(config: ChaosExperimentConfig): ChaosExperimentResult {
    const { experimentId, schedule, topologyEdges, totalRequests } = config;
    const baseLatencyUs = config.baseLatencyUs ?? 5000; // 5ms baseline

    // 1. Analyze topological cascade and blast radius
    const cascade = CascadeAnalyzer.analyzeBlastRadius(schedule.targetNodeId, topologyEdges);

    // 2. Simulate baseline run (no faults)
    const baselineP99 = baseLatencyUs * 1.5;
    const baselineThroughput = 500; // RPS
    const baselineErrorRate = 0;

    // 3. Simulate chaos run with fault active during schedule window
    let failedRequests = 0;
    let degradedRequests = 0;
    let fallbackRequests = 0;
    const latencies: number[] = [];

    const scheduleMidpoint = schedule.startVirtualTimeUs + schedule.durationVirtualTimeUs / 2;

    for (let i = 0; i < totalRequests; i++) {
      // Half the requests fall within the fault window
      const isDuringFault = i >= totalRequests * 0.25 && i <= totalRequests * 0.75;
      const virtualTime = isDuringFault ? scheduleMidpoint : 0;

      const evalResult = FaultInjector.evaluateCall(
        schedule,
        schedule.targetNodeId,
        virtualTime,
        baseLatencyUs,
      );

      latencies.push(evalResult.latencyUs);

      if (evalResult.failed) {
        failedRequests++;
        if (evalResult.circuitTripped) {
          // If circuit breaker tripped, some calls fallback successfully
          fallbackRequests++;
        }
      } else if (evalResult.degraded) {
        degradedRequests++;
      }
    }

    latencies.sort((a, b) => a - b);
    const chaosP99 = latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.99)]! : 0;
    const chaosErrorRate = totalRequests > 0 ? failedRequests / totalRequests : 0;
    const chaosThroughput = baselineThroughput * (1 - chaosErrorRate * 0.5);

    // Recovery time: virtual time between fault end and return to baseline (e.g. 50ms)
    const recoveryTimeUs = 50000; // 50ms

    // 4. Compute resilience metrics
    const resilience = ResilienceEvaluator.evaluate({
      blastRadius: cascade.blastRadius,
      cascadeDetected: cascade.isCascade,
      totalRequests,
      failedRequests,
      degradedRequests,
      fallbackRequests,
      faultDurationUs: schedule.durationVirtualTimeUs,
      recoveryTimeUs,
    });

    return {
      experimentId,
      faultType: schedule.type,
      targetNodeId: schedule.targetNodeId,
      baselineMetrics: {
        throughputRps: baselineThroughput,
        p99Us: baselineP99,
        errorRate: baselineErrorRate,
      },
      chaosMetrics: {
        throughputRps: chaosThroughput,
        p99Us: chaosP99,
        errorRate: chaosErrorRate,
      },
      resilience,
    };
  }
}
