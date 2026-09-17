import { BottleneckAttribution } from '../types.js';

export interface ComponentResourceMetrics {
  componentId: string;
  cpuUtilization: number;
  threadPoolUtilization: number;
  connectionPoolUtilization: number;
}

export function identifyBottleneck(components: ComponentResourceMetrics[]): BottleneckAttribution | undefined {
  if (components.length === 0) return undefined;

  let maxUtil = -1;
  let bottleneckComp = '';
  let bottleneckType: 'CPU' | 'THREADPOOL' | 'CONNECTION_POOL' = 'CPU';

  for (const c of components) {
    if (c.cpuUtilization > maxUtil) {
      maxUtil = c.cpuUtilization;
      bottleneckComp = c.componentId;
      bottleneckType = 'CPU';
    }
    if (c.threadPoolUtilization > maxUtil) {
      maxUtil = c.threadPoolUtilization;
      bottleneckComp = c.componentId;
      bottleneckType = 'THREADPOOL';
    }
    if (c.connectionPoolUtilization > maxUtil) {
      maxUtil = c.connectionPoolUtilization;
      bottleneckComp = c.componentId;
      bottleneckType = 'CONNECTION_POOL';
    }
  }

  let recommendation = '';
  switch (bottleneckType) {
    case 'CPU':
      recommendation = `Scale CPU cores or optimize hot path in ${bottleneckComp}`;
      break;
    case 'THREADPOOL':
      recommendation = `Increase worker threads or increase upstream queue capacity in ${bottleneckComp}`;
      break;
    case 'CONNECTION_POOL':
      recommendation = `Increase connection pool maxConnections or reduce query hold time in ${bottleneckComp}`;
      break;
  }

  return {
    limitingComponent: bottleneckComp,
    limitingResourceType: bottleneckType,
    utilization: maxUtil,
    recommendation,
  };
}
