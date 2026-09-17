import type {
  NodeKind,
  EdgeKind,
  CycleClassification,
} from '@blackbox-x/contracts';

export interface GraphNode {
  id: string;
  name: string;
  kind: NodeKind;
  metadata?: Record<string, unknown>;
}

export interface GraphEdge {
  id: string;
  sourceId: string;
  targetId: string;
  kind: EdgeKind;
  metadata?: Record<string, unknown>;
  p99LatencyMs?: number;
  timeoutMs?: number;
  retryCount?: number;
  trafficShare?: number;
}

export interface CycleResult {
  path: string[]; // Node IDs in the cycle: [A, B, C, A]
  edges: GraphEdge[];
  classification: CycleClassification;
  permitted: boolean;
  reason: string;
}

export interface ValidationResult {
  valid: boolean;
  nodeCount: number;
  edgeCount: number;
  cycles: CycleResult[];
  errors: string[];
}
