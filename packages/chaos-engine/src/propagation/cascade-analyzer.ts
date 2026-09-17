export interface GraphEdge {
  sourceNodeId: string;
  targetNodeId: string;
  edgeKind: string;
}

export interface CascadeAnalysisResult {
  targetNodeId: string;
  upstreamNodeIds: string[];
  blastRadius: number;
  depth: number;
  isCascade: boolean;
}

export class CascadeAnalyzer {
  static analyzeBlastRadius(
    targetNodeId: string,
    edges: GraphEdge[],
  ): CascadeAnalysisResult {
    // Upstream dependency traversal (reverse BFS: nodes that point to targetNodeId)
    const upstreamNodes = new Set<string>();
    const queue: Array<{ nodeId: string; depth: number }> = [{ nodeId: targetNodeId, depth: 0 }];
    const visited = new Set<string>([targetNodeId]);
    let maxDepth = 0;

    while (queue.length > 0) {
      const current = queue.shift()!;
      maxDepth = Math.max(maxDepth, current.depth);

      // Find edges where targetNodeId === current.nodeId
      const callers = edges.filter((e) => e.targetNodeId === current.nodeId);
      for (const caller of callers) {
        if (!visited.has(caller.sourceNodeId)) {
          visited.add(caller.sourceNodeId);
          upstreamNodes.add(caller.sourceNodeId);
          queue.push({
            nodeId: caller.sourceNodeId,
            depth: current.depth + 1,
          });
        }
      }
    }

    const upstreamList = Array.from(upstreamNodes);
    return {
      targetNodeId,
      upstreamNodeIds: upstreamList,
      blastRadius: upstreamList.length,
      depth: maxDepth,
      isCascade: maxDepth >= 2,
    };
  }
}
