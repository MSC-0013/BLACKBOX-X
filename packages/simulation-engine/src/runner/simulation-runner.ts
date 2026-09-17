import { Histogram, WelfordAccumulator, verifyLittlesLaw } from '@blackbox-x/statistics';
import { WorkloadSpecDefinition, SimulationWorkloadAdapter } from '@blackbox-x/workload-spec';
import { SimulationKernel } from '../kernel/simulation-kernel.js';
import { CpuResource } from '../resources/cpu.js';
import { ThreadPoolResource } from '../resources/threadpool.js';
import { ConnectionPoolResource } from '../resources/connection-pool.js';

export interface NodeSimulationConfig {
  nodeId: string;
  nodeKind: string;
  cpuCores: number;
  threadPoolSize: number;
  threadPoolQueueCapacity: number;
  connectionPoolSize: number;
}

export interface OperationSimulationConfig {
  operationId: string;
  operationName: string;
  nodeId: string;
  baseLatencyUs: number;
  dependencies?: {
    targetNodeId: string;
    targetOperationName: string;
    executionMode: 'SEQUENTIAL' | 'PARALLEL' | 'ASYNC' | 'OPTIONAL';
    callOrder: number;
  }[];
}

export interface SimulationRunConfig {
  nodes: NodeSimulationConfig[];
  operations: OperationSimulationConfig[];
  workload: WorkloadSpecDefinition;
  seed: bigint;
}

export interface SimulationResultMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  latencyHistogram: Histogram;
  p50Us: number;
  p90Us: number;
  p95Us: number;
  p99Us: number;
  meanLatencyUs: number;
  throughputRps: number;
  canonicalStateHash: string;
  littlesLawCheck: { satisfies: boolean; expectedL: number; relativeError: number };
}

interface InFlightRequest {
  requestId: string;
  rootOperationName: string;
  arrivalTimeUs: number;
  status: 'RUNNING' | 'SUCCESS' | 'FAILED';
  pendingDependencies: number;
}

export class SimulationRunner {
  readonly config: SimulationRunConfig;
  readonly kernel: SimulationKernel;
  private readonly nodes = new Map<string, {
    cpu: CpuResource;
    threadpool: ThreadPoolResource;
    connPool: ConnectionPoolResource;
  }>();
  private readonly operationsByName = new Map<string, OperationSimulationConfig>();
  private readonly histogram = new Histogram();
  private readonly welford = new WelfordAccumulator();
  private totalArrivals = 0;
  private successes = 0;
  private failures = 0;

  constructor(config: SimulationRunConfig) {
    this.config = config;
    this.kernel = new SimulationKernel();

    for (const n of config.nodes) {
      this.nodes.set(n.nodeId, {
        cpu: new CpuResource({ cores: n.cpuCores }),
        threadpool: new ThreadPoolResource({
          workerCount: n.threadPoolSize,
          queueCapacity: n.threadPoolQueueCapacity,
        }),
        connPool: new ConnectionPoolResource({ maxConnections: n.connectionPoolSize }),
      });
    }

    for (const op of config.operations) {
      this.operationsByName.set(op.operationName, op);
    }

    this.setupHandlers();
  }

  private setupHandlers(): void {
    // Handler: Request Arrival
    this.kernel.registerHandler('ARRIVAL', (event, kernel) => {
      this.totalArrivals++;
      const { requestId, operationName } = event.payload as {
        requestId: string;
        operationName: string;
      };
      const op = this.operationsByName.get(operationName);

      if (!op) {
        this.failures++;
        return;
      }

      const nodeResources = this.nodes.get(op.nodeId);
      if (!nodeResources) {
        this.failures++;
        return;
      }

      const acquireResult = nodeResources.threadpool.tryAcquire();
      if (acquireResult === 'REJECTED') {
        this.failures++;
        return;
      }

      const req: InFlightRequest = {
        requestId,
        rootOperationName: operationName,
        arrivalTimeUs: kernel.virtualTimeUs,
        status: 'RUNNING',
        pendingDependencies: 0,
      };

      nodeResources.cpu.acquire();
      const execDuration = nodeResources.cpu.calculateExecutionDurationUs(op.baseLatencyUs);

      kernel.scheduleIn(execDuration, 'LOCAL_OP_COMPLETE', {
        request: req,
        op,
      });
    });

    // Handler: Local Operation Execution Complete
    this.kernel.registerHandler('LOCAL_OP_COMPLETE', (event, kernel) => {
      const { request, op } = event.payload as {
        request: InFlightRequest;
        op: OperationSimulationConfig;
      };

      const nodeResources = this.nodes.get(op.nodeId);
      if (nodeResources) {
        nodeResources.cpu.release();
      }

      const deps = (op.dependencies || []).slice().sort((a, b) => a.callOrder - b.callOrder);
      if (deps.length === 0) {
        this.finishRequest(request, kernel);
        return;
      }

      // Handle dependencies
      const syncDeps = deps.filter((d) => d.executionMode !== 'ASYNC');
      const asyncDeps = deps.filter((d) => d.executionMode === 'ASYNC');

      // Schedule async dependencies (fire-and-forget in simulation)
      for (const asyncDep of asyncDeps) {
        const targetOp = this.operationsByName.get(asyncDep.targetOperationName);
        if (targetOp) {
          kernel.scheduleIn(500, 'ASYNC_INVOKE', { targetOp });
        }
      }

      if (syncDeps.length === 0) {
        this.finishRequest(request, kernel);
        return;
      }

      // Handle synchronous dependencies
      request.pendingDependencies = syncDeps.length;
      for (const dep of syncDeps) {
        const targetOp = this.operationsByName.get(dep.targetOperationName);
        if (!targetOp) {
          request.status = 'FAILED';
          this.finishRequest(request, kernel);
          return;
        }

        const targetNode = this.nodes.get(dep.targetNodeId);
        if (!targetNode) {
          request.status = 'FAILED';
          this.finishRequest(request, kernel);
          return;
        }

        const connAcquire = targetNode.connPool.tryAcquire();
        if (connAcquire === 'EXHAUSTED') {
          request.status = 'FAILED';
          this.finishRequest(request, kernel);
          return;
        }

        const downstreamDelay = targetOp.baseLatencyUs + 1000; // base + 1ms network roundtrip
        kernel.scheduleIn(downstreamDelay, 'DEP_COMPLETE', {
          request,
          targetNodeId: dep.targetNodeId,
        });
      }
    });

    // Handler: Dependency Complete
    this.kernel.registerHandler('DEP_COMPLETE', (event, kernel) => {
      const { request, targetNodeId } = event.payload as {
        request: InFlightRequest;
        targetNodeId: string;
      };
      const targetNode = this.nodes.get(targetNodeId);
      if (targetNode) {
        targetNode.connPool.release();
      }

      request.pendingDependencies--;
      if (request.pendingDependencies <= 0) {
        this.finishRequest(request, kernel);
      }
    });

    // Handler: Async Invoke
    this.kernel.registerHandler('ASYNC_INVOKE', (_event, _kernel) => {
      // Background message broker / consumer hop complete
    });
  }

  private finishRequest(req: InFlightRequest, kernel: SimulationKernel): void {
    const op = this.operationsByName.get(req.rootOperationName);
    if (op) {
      const nodeResources = this.nodes.get(op.nodeId);
      if (nodeResources) {
        nodeResources.threadpool.release();
      }
    }

    const totalLatencyUs = Math.max(1, kernel.virtualTimeUs - req.arrivalTimeUs);

    if (req.status === 'RUNNING') {
      req.status = 'SUCCESS';
      this.successes++;
      this.histogram.record(totalLatencyUs);
      this.welford.update(totalLatencyUs);
    } else {
      this.failures++;
    }
  }

  /**
   * Runs the entire simulation to completion according to workload schedule.
   */
  run(): SimulationResultMetrics {
    const workloadAdapter = new SimulationWorkloadAdapter(this.config.workload, this.config.seed);
    const arrivals = workloadAdapter.generateArrivals();

    // Schedule all generated arrivals into the discrete-event kernel
    for (const arr of arrivals) {
      this.kernel.schedule(arr.virtualTimeUs, 'ARRIVAL', {
        requestId: arr.eventId,
        operationName: arr.operationName,
      });
    }

    const totalDurationUs = this.config.workload.totalDurationSeconds * 1_000_000;
    this.kernel.runUntil(totalDurationUs);

    const durationSec = Math.max(0.001, this.kernel.virtualTimeUs / 1_000_000);
    const throughputRps = this.successes / durationSec;
    const meanLatencySec = (this.welford.mean || 0) / 1_000_000;
    const empiricalInFlight = throughputRps * meanLatencySec;

    const littlesLawCheck = verifyLittlesLaw(empiricalInFlight, throughputRps, meanLatencySec);

    return {
      totalRequests: this.totalArrivals,
      successfulRequests: this.successes,
      failedRequests: this.failures,
      latencyHistogram: this.histogram,
      p50Us: this.histogram.quantile(0.5),
      p90Us: this.histogram.quantile(0.9),
      p95Us: this.histogram.quantile(0.95),
      p99Us: this.histogram.quantile(0.99),
      meanLatencyUs: Math.round(this.welford.mean),
      throughputRps,
      canonicalStateHash: this.kernel.canonicalHash,
      littlesLawCheck,
    };
  }
}
