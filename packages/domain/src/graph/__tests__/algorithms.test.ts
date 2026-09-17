import { describe, it, expect } from 'vitest';
import { TopologyGraph } from '../graph.js';
import {
  detectCycles,
  validateTopology,
  topologicalSort,
} from '../algorithms.js';

describe('Graph Algorithms & Cycle Classification', () => {
  it('computes topological sort across mixed node kinds in a DAG', () => {
    const graph = new TopologyGraph();
    graph.addNode({ id: 'order', name: 'Order Service', kind: 'SERVICE' });
    graph.addNode({ id: 'kafka', name: 'Kafka Cluster', kind: 'MESSAGE_BROKER' });
    graph.addNode({ id: 'notify', name: 'Notification Service', kind: 'SERVICE' });
    graph.addNode({ id: 'db', name: 'Notification DB', kind: 'DATABASE' });

    graph.addEdge({ id: 'e1', sourceId: 'order', targetId: 'kafka', kind: 'KAFKA_PUBLISH' });
    graph.addEdge({ id: 'e2', sourceId: 'kafka', targetId: 'notify', kind: 'KAFKA_CONSUME' });
    graph.addEdge({ id: 'e3', sourceId: 'notify', targetId: 'db', kind: 'DB_QUERY' });

    const order = topologicalSort(graph);
    expect(order).toEqual(['order', 'kafka', 'notify', 'db']);
  });

  it('rejects an all-synchronous cycle with hard validation error', () => {
    const graph = new TopologyGraph();
    graph.addNode({ id: 'srvA', name: 'Service A', kind: 'SERVICE' });
    graph.addNode({ id: 'srvB', name: 'Service B', kind: 'SERVICE' });
    graph.addNode({ id: 'srvC', name: 'Service C', kind: 'SERVICE' });

    graph.addEdge({ id: 'e1', sourceId: 'srvA', targetId: 'srvB', kind: 'SYNC_HTTP' });
    graph.addEdge({ id: 'e2', sourceId: 'srvB', targetId: 'srvC', kind: 'SYNC_HTTP' });
    graph.addEdge({ id: 'e3', sourceId: 'srvC', targetId: 'srvA', kind: 'SYNC_HTTP' });

    const validation = validateTopology(graph);
    expect(validation.valid).toBe(false);
    expect(validation.cycles).toHaveLength(1);
    expect(validation.cycles[0]?.classification).toBe('ALL_SYNCHRONOUS');
    expect(validation.cycles[0]?.permitted).toBe(false);
  });

  it('accepts an asynchronous Kafka-mediated loop', () => {
    const graph = new TopologyGraph();
    graph.addNode({ id: 'srvA', name: 'Order Service', kind: 'SERVICE' });
    graph.addNode({ id: 'kafka', name: 'Kafka Broker', kind: 'MESSAGE_BROKER' });
    graph.addNode({ id: 'srvB', name: 'Notification Service', kind: 'SERVICE' });

    // A -> Kafka -> B -> Kafka -> A
    graph.addEdge({ id: 'e1', sourceId: 'srvA', targetId: 'kafka', kind: 'KAFKA_PUBLISH' });
    graph.addEdge({ id: 'e2', sourceId: 'kafka', targetId: 'srvB', kind: 'KAFKA_CONSUME' });
    graph.addEdge({ id: 'e3', sourceId: 'srvB', targetId: 'kafka', kind: 'KAFKA_PUBLISH' });
    graph.addEdge({ id: 'e4', sourceId: 'kafka', targetId: 'srvA', kind: 'KAFKA_CONSUME' });

    const cycles = detectCycles(graph);
    expect(cycles.length).toBeGreaterThan(0);

    const validation = validateTopology(graph);
    expect(validation.valid).toBe(true);
    expect(validation.cycles.every((c) => c.permitted)).toBe(true);
    expect(validation.cycles[0]?.classification).toBe('ASYNC_EVENT_DRIVEN');
  });

  it('rejects mixed cycle without runaway guard, but accepts with declared guard', () => {
    const graph = new TopologyGraph();
    graph.addNode({ id: 'srvA', name: 'Frontend Service', kind: 'SERVICE' });
    graph.addNode({ id: 'srvB', name: 'Backend Service', kind: 'SERVICE' });
    graph.addNode({ id: 'kafka', name: 'Kafka Broker', kind: 'MESSAGE_BROKER' });

    // Sync call srvA -> srvB, then async publish srvB -> kafka, then async consume kafka -> srvA
    graph.addEdge({ id: 'e1', sourceId: 'srvA', targetId: 'srvB', kind: 'SYNC_HTTP' });
    graph.addEdge({ id: 'e2', sourceId: 'srvB', targetId: 'kafka', kind: 'KAFKA_PUBLISH' });
    graph.addEdge({ id: 'e3', sourceId: 'kafka', targetId: 'srvA', kind: 'KAFKA_CONSUME' });

    // Without guard: should fail
    const unguarded = validateTopology(graph);
    expect(unguarded.valid).toBe(false);
    expect(unguarded.cycles[0]?.classification).toBe('MIXED');
    expect(unguarded.cycles[0]?.permitted).toBe(false);

    // With guard: should pass
    const guarded = validateTopology(graph, { maxHops: 32 });
    expect(guarded.valid).toBe(true);
    expect(guarded.cycles[0]?.permitted).toBe(true);
  });
});
