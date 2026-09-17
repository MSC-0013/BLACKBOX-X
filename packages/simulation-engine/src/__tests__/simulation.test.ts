import { describe, it, expect } from 'vitest';
import {
  EventQueue,
  CanonicalStateHasher,
  CpuResource,
  ThreadPoolResource,
  ConnectionPoolResource,
  SimulationKernel,
  SimulationRunner,
  SimulationRunConfig,
} from '../index.js';

describe('Simulation Engine', () => {
  describe('EventQueue', () => {
    it('orders events deterministically by time, priority, and sequenceNum', () => {
      const q = new EventQueue();

      q.push(100, 'EVENT_B', { order: 2 });
      q.push(50, 'EVENT_A', { order: 1 });
      q.push(100, 'EVENT_C', { order: 3 }, -1); // higher priority (lower number)

      expect(q.pop()?.type).toBe('EVENT_A'); // time 50
      expect(q.pop()?.type).toBe('EVENT_C'); // time 100, prio -1
      expect(q.pop()?.type).toBe('EVENT_B'); // time 100, prio 0
      expect(q.pop()).toBeUndefined();
    });

    it('cancels scheduled events correctly', () => {
      const q = new EventQueue();
      const ev1 = q.push(10, 'A', {});
      q.push(20, 'B', {});

      q.cancel(ev1.id);
      expect(q.pop()?.type).toBe('B');
      expect(q.isEmpty).toBe(true);
    });

    it('serializes and restores exact state', () => {
      const q1 = new EventQueue();
      q1.push(10, 'A', { val: 1 });
      q1.push(20, 'B', { val: 2 });
      q1.push(15, 'C', { val: 3 });

      const state = q1.serializeState();
      const q2 = new EventQueue();
      q2.restoreState(state);

      expect(q2.pop()?.type).toBe('A');
      expect(q2.pop()?.type).toBe('C');
      expect(q2.pop()?.type).toBe('B');
    });
  });

  describe('CanonicalStateHasher', () => {
    it('generates identical hash regardless of key order', () => {
      const h1 = new CanonicalStateHasher();
      h1.update(100, 'OP', { a: 1, b: 2, c: { x: 10, y: 20 } });

      const h2 = new CanonicalStateHasher();
      h2.update(100, 'OP', { c: { y: 20, x: 10 }, b: 2, a: 1 });

      expect(h1.getHash()).toBe(h2.getHash());
    });

    it('generates different hash for different events', () => {
      const h1 = new CanonicalStateHasher();
      h1.update(100, 'OP_A', { x: 1 });

      const h2 = new CanonicalStateHasher();
      h2.update(100, 'OP_B', { x: 1 });

      expect(h1.getHash()).not.toBe(h2.getHash());
    });
  });

  describe('Resources', () => {
    it('CpuResource stretches duration when oversubscribed', () => {
      const cpu = new CpuResource({ cores: 2 });
      expect(cpu.calculateExecutionDurationUs(1000)).toBe(1000);

      cpu.acquire();
      cpu.acquire();
      // 2 tasks on 2 cores -> stretch 1.0
      expect(cpu.calculateExecutionDurationUs(1000)).toBe(1000);

      cpu.acquire();
      cpu.acquire();
      // 4 tasks on 2 cores -> stretch 4/2 = 2.0
      expect(cpu.calculateExecutionDurationUs(1000)).toBe(2000);
    });

    it('ThreadPool and ConnectionPool manage concurrency and queues', () => {
      const pool = new ThreadPoolResource({ workerCount: 1, queueCapacity: 1 });
      expect(pool.tryAcquire()).toBe('IMMEDIATE');
      expect(pool.tryAcquire()).toBe('QUEUED');
      expect(pool.tryAcquire()).toBe('REJECTED');

      const releaseResult = pool.release();
      expect(releaseResult.promotedFromQueue).toBe(true);

      const conn = new ConnectionPoolResource({ maxConnections: 1, maxWaiters: 1 });
      expect(conn.tryAcquire()).toBe('ACQUIRED');
      expect(conn.tryAcquire()).toBe('WAITING');
      expect(conn.tryAcquire()).toBe('EXHAUSTED');
    });
  });

  describe('SimulationKernel', () => {
    it('executes handlers and preserves time monotonicity', () => {
      const kernel = new SimulationKernel();
      const trace: string[] = [];

      kernel.registerHandler('STEP_1', (_ev, k) => {
        trace.push(`step1_${k.virtualTimeUs}`);
        k.scheduleIn(500, 'STEP_2', {});
      });

      kernel.registerHandler('STEP_2', (_ev, k) => {
        trace.push(`step2_${k.virtualTimeUs}`);
      });

      kernel.schedule(1000, 'STEP_1', {});
      kernel.runUntil(5000);

      expect(trace).toEqual(['step1_1000', 'step2_1500']);
      expect(kernel.virtualTimeUs).toBe(1500);
    });

    it('supports checkpoint and resume', () => {
      const kernel1 = new SimulationKernel();
      kernel1.schedule(100, 'EV', { n: 1 });
      kernel1.schedule(200, 'EV', { n: 2 });
      kernel1.schedule(300, 'EV', { n: 3 });

      kernel1.step(); // reaches 100
      const checkpoint = kernel1.createCheckpoint();

      const kernel2 = new SimulationKernel();
      kernel2.resumeCheckpoint(checkpoint);

      expect(kernel2.virtualTimeUs).toBe(100);
      expect(kernel2.canonicalHash).toBe(kernel1.canonicalHash);

      kernel2.step(); // reaches 200
      expect(kernel2.virtualTimeUs).toBe(200);
    });
  });

  describe('SimulationRunner', () => {
    const testConfig: SimulationRunConfig = {
      nodes: [
        {
          nodeId: 'node_gateway',
          nodeKind: 'SERVICE',
          cpuCores: 4,
          threadPoolSize: 10,
          threadPoolQueueCapacity: 50,
          connectionPoolSize: 20,
        },
        {
          nodeId: 'node_db',
          nodeKind: 'DATABASE',
          cpuCores: 8,
          threadPoolSize: 20,
          threadPoolQueueCapacity: 100,
          connectionPoolSize: 50,
        },
      ],
      operations: [
        {
          operationId: 'op_ingress',
          operationName: 'get_user_profile',
          nodeId: 'node_gateway',
          baseLatencyUs: 2000,
          dependencies: [
            {
              targetNodeId: 'node_db',
              targetOperationName: 'query_user_row',
              executionMode: 'SEQUENTIAL',
              callOrder: 1,
            },
          ],
        },
        {
          operationId: 'op_db_query',
          operationName: 'query_user_row',
          nodeId: 'node_db',
          baseLatencyUs: 5000,
        },
      ],
      workload: {
        id: 'wkld_sim_test',
        name: 'Sim Ingress Workload',
        arrivalPattern: 'CONSTANT',
        arrivalParams: { rateRps: 100 },
        requestMix: [{ operationName: 'get_user_profile', weight: 1.0 }],
        totalDurationSeconds: 1,
      },
      seed: 987654321n,
    };

    it('produces 100% bit-for-bit identical canonical hash on identical runs', () => {
      const runner1 = new SimulationRunner(testConfig);
      const res1 = runner1.run();

      const runner2 = new SimulationRunner(testConfig);
      const res2 = runner2.run();

      expect(res1.successfulRequests).toBe(res2.successfulRequests);
      expect(res1.p50Us).toBe(res2.p50Us);
      expect(res1.canonicalStateHash).toBe(res2.canonicalStateHash);
    });
  });
});
