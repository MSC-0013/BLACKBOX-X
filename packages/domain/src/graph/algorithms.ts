import {
  SynchronousEdgeKinds,
  AsynchronousEdgeKinds,
  type RunawayGuard,
} from '@blackbox-x/contracts';
import { TopologyGraph } from './graph.js';
import type { GraphEdge, CycleResult, ValidationResult } from './types.js';

/**
 * Detects all elementary directed cycles in the topology graph.
 */
export function detectCycles(
  graph: TopologyGraph,
): Array<{ path: string[]; edges: GraphEdge[] }> {
  const nodes = graph.getNodes();
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const stack: string[] = [];
  const edgeStack: GraphEdge[] = [];
  const detectedCycles: Array<{ path: string[]; edges: GraphEdge[] }> = [];

  function dfs(curr: string) {
    visited.add(curr);
    inStack.add(curr);
    stack.push(curr);

    for (const edge of graph.getOutgoingEdges(curr)) {
      const next = edge.targetId;
      edgeStack.push(edge);

      if (inStack.has(next)) {
        // Cycle detected
        const startIndex = stack.indexOf(next);
        if (startIndex !== -1) {
          const cyclePath = [...stack.slice(startIndex), next];
          const cycleEdges = edgeStack.slice(startIndex);
          detectedCycles.push({
            path: cyclePath,
            edges: [...cycleEdges],
          });
        }
      } else if (!visited.has(next)) {
        dfs(next);
      }

      edgeStack.pop();
    }

    stack.pop();
    inStack.delete(curr);
  }

  for (const node of nodes) {
    if (!visited.has(node.id)) {
      dfs(node.id);
    }
  }

  return detectedCycles;
}

/**
 * Classifies a detected cycle according to Part 2 (M1) and Part 9 rules.
 */
export function classifyCycle(
  path: string[],
  edges: GraphEdge[],
  graph: TopologyGraph,
  guard?: RunawayGuard,
): CycleResult {
  const hasAsyncEdge = edges.some((e) => AsynchronousEdgeKinds.has(e.kind));
  const hasSyncEdge = edges.some((e) => SynchronousEdgeKinds.has(e.kind));

  // Check if at least one node in the cycle is a MESSAGE_BROKER
  const hasMessageBrokerNode = path.some((nodeId) => {
    const node = graph.getNode(nodeId);
    return node?.kind === 'MESSAGE_BROKER';
  });

  if (!hasAsyncEdge) {
    // Entirely synchronous
    return {
      path,
      edges,
      classification: 'ALL_SYNCHRONOUS',
      permitted: false,
      reason:
        'All-synchronous cycle detected: synchronous circular dependencies cause distributed deadlocks and are strictly forbidden.',
    };
  }

  if (hasAsyncEdge && !hasSyncEdge && hasMessageBrokerNode) {
    // Purely asynchronous broker-mediated loop
    return {
      path,
      edges,
      classification: 'ASYNC_EVENT_DRIVEN',
      permitted: true,
      reason:
        'Asynchronous broker-mediated loop: event-driven asynchronous feedback loops are valid.',
    };
  }

  // Mixed cycle (contains both sync and async hops or broker loops with sync segments)
  if (hasAsyncEdge && hasMessageBrokerNode) {
    const hasGuard = Boolean(
      guard && (guard.maxHops || guard.ttlSeconds || guard.eventBudget),
    );

    return {
      path,
      edges,
      classification: 'MIXED',
      permitted: hasGuard,
      reason: hasGuard
        ? `Mixed cycle permitted with declared runaway guard (maxHops=${guard?.maxHops ?? 32}).`
        : 'Mixed cycle rejected: requires an explicit max_hops, TTL, or event_budget runaway guard.',
    };
  }

  // Fallback for general async cycles without message broker
  return {
    path,
    edges,
    classification: 'MIXED',
    permitted: false,
    reason: 'Cycle contains async edges without a valid MESSAGE_BROKER node.',
  };
}

/**
 * Validates topology rules and invariants per Part 2 (M1).
 */
export function validateTopology(
  graph: TopologyGraph,
  guard?: RunawayGuard,
): ValidationResult {
  const rawCycles = detectCycles(graph);
  const cycles: CycleResult[] = [];
  const errors: string[] = [];

  for (const raw of rawCycles) {
    const classified = classifyCycle(raw.path, raw.edges, graph, guard);
    cycles.push(classified);
    if (!classified.permitted) {
      errors.push(
        `Cycle error [${classified.classification}]: ${classified.path.join(' -> ')}. ${classified.reason}`,
      );
    }
  }

  return {
    valid: errors.length === 0,
    nodeCount: graph.getNodes().length,
    edgeCount: graph.getEdges().length,
    cycles,
    errors,
  };
}

/**
 * Computes topological ordering of nodes across mixed node kinds using Kahn's algorithm.
 * Throws an Error if a synchronous cycle or non-permitted cycle exists.
 */
export function topologicalSort(graph: TopologyGraph): string[] {
  const nodes = graph.getNodes();
  const inDegree = new Map<string, number>();

  for (const node of nodes) {
    inDegree.set(node.id, 0);
  }

  for (const edge of graph.getEdges()) {
    inDegree.set(edge.targetId, (inDegree.get(edge.targetId) || 0) + 1);
  }

  const queue: string[] = [];
  for (const [nodeId, deg] of inDegree.entries()) {
    if (deg === 0) {
      queue.push(nodeId);
    }
  }

  const result: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    result.push(current);

    for (const edge of graph.getOutgoingEdges(current)) {
      const neighbor = edge.targetId;
      const newDeg = (inDegree.get(neighbor) || 1) - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) {
        queue.push(neighbor);
      }
    }
  }

  if (result.length !== nodes.length) {
    throw new Error('Graph contains a cycle; topological order cannot be computed');
  }

  return result;
}
