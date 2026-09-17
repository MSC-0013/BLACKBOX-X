import type { GraphNode, GraphEdge } from './types.js';

export class TopologyGraph {
  private nodes = new Map<string, GraphNode>();
  private edges = new Map<string, GraphEdge>();
  private outgoing = new Map<string, GraphEdge[]>();
  private incoming = new Map<string, GraphEdge[]>();

  public addNode(node: GraphNode): void {
    this.nodes.set(node.id, node);
    if (!this.outgoing.has(node.id)) {
      this.outgoing.set(node.id, []);
    }
    if (!this.incoming.has(node.id)) {
      this.incoming.set(node.id, []);
    }
  }

  public getNode(id: string): GraphNode | undefined {
    return this.nodes.get(id);
  }

  public getNodes(): GraphNode[] {
    return Array.from(this.nodes.values());
  }

  public hasNode(id: string): boolean {
    return this.nodes.has(id);
  }

  public addEdge(edge: GraphEdge): void {
    if (!this.nodes.has(edge.sourceId)) {
      throw new Error(`Source node not found: ${edge.sourceId}`);
    }
    if (!this.nodes.has(edge.targetId)) {
      throw new Error(`Target node not found: ${edge.targetId}`);
    }

    this.edges.set(edge.id, edge);

    const outList = this.outgoing.get(edge.sourceId) ?? [];
    outList.push(edge);
    this.outgoing.set(edge.sourceId, outList);

    const inList = this.incoming.get(edge.targetId) ?? [];
    inList.push(edge);
    this.incoming.set(edge.targetId, inList);
  }

  public getEdges(): GraphEdge[] {
    return Array.from(this.edges.values());
  }

  public getOutgoingEdges(nodeId: string): GraphEdge[] {
    return this.outgoing.get(nodeId) ?? [];
  }

  public getIncomingEdges(nodeId: string): GraphEdge[] {
    return this.incoming.get(nodeId) ?? [];
  }

  public findEdge(sourceId: string, targetId: string): GraphEdge | undefined {
    const outEdges = this.outgoing.get(sourceId) ?? [];
    return outEdges.find((e) => e.targetId === targetId);
  }
}
