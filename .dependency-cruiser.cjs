/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'contracts-zero-workspace-deps',
      comment: 'packages/contracts must have zero workspace dependencies',
      severity: 'error',
      from: {
        path: '^packages/contracts',
      },
      to: {
        path: '^packages/(?!contracts)',
      },
    },
    {
      name: 'logging-zero-workspace-deps',
      comment: 'packages/logging must have zero workspace dependencies',
      severity: 'error',
      from: {
        path: '^packages/logging',
      },
      to: {
        path: '^packages/(?!logging)',
      },
    },
    {
      name: 'statistics-zero-workspace-deps',
      comment: 'packages/statistics must have zero workspace dependencies',
      severity: 'error',
      from: {
        path: '^packages/statistics',
      },
      to: {
        path: '^packages/(?!statistics)',
      },
    },
    {
      name: 'workload-spec-allowed-deps',
      comment: 'packages/workload-spec must only depend on contracts and statistics',
      severity: 'error',
      from: {
        path: '^packages/workload-spec',
      },
      to: {
        path: '^packages/(?!workload-spec|contracts|statistics)',
      },
    },
    {
      name: 'simulation-engine-allowed-deps',
      comment: 'packages/simulation-engine must only depend on contracts, domain, statistics, and workload-spec',
      severity: 'error',
      from: {
        path: '^packages/simulation-engine',
      },
      to: {
        path: '^packages/(?!simulation-engine|contracts|domain|statistics|workload-spec)',
      },
    },
    {
      name: 'comparison-allowed-deps',
      comment: 'packages/comparison must only depend on contracts, statistics, workload-spec, and simulation-engine',
      severity: 'error',
      from: {
        path: '^packages/comparison',
      },
      to: {
        path: '^packages/(?!comparison|contracts|statistics|workload-spec|simulation-engine)',
      },
    },
    {
      name: 'capacity-search-allowed-deps',
      comment: 'packages/capacity-search must only depend on contracts, statistics, workload-spec, and simulation-engine',
      severity: 'error',
      from: {
        path: '^packages/capacity-search',
      },
      to: {
        path: '^packages/(?!capacity-search|contracts|statistics|workload-spec|simulation-engine)',
      },
    },
    {
      name: 'calibration-allowed-deps',
      comment: 'packages/calibration must only depend on contracts, statistics, workload-spec, simulation-engine, and comparison',
      severity: 'error',
      from: {
        path: '^packages/calibration',
      },
      to: {
        path: '^packages/(?!calibration|contracts|statistics|workload-spec|simulation-engine|comparison)',
      },
    },
    {
      name: 'load-orchestrator-allowed-deps',
      comment: 'packages/load-orchestrator must only depend on contracts, logging, statistics, workload-spec, and comparison',
      severity: 'error',
      from: {
        path: '^packages/load-orchestrator',
      },
      to: {
        path: '^packages/(?!load-orchestrator|contracts|logging|statistics|workload-spec|comparison)',
      },
    },
    {
      name: 'domain-layer-purity',
      comment: 'packages/domain must only import from contracts',
      severity: 'error',
      from: {
        path: '^packages/domain',
      },
      to: {
        path: '^packages/(?!contracts|domain)',
      },
    },
    {
      name: 'config-client-trust-boundary',
      comment: 'packages/config-client must never import config-server or server code',
      severity: 'error',
      from: {
        path: '^packages/config-client',
      },
      to: {
        path: '^packages/config-server',
      },
    },
    {
      name: 'packages-cannot-import-apps',
      comment: 'packages/* must never import from apps/*',
      severity: 'error',
      from: {
        path: '^packages',
      },
      to: {
        path: '^apps',
      },
    },
    {
      name: 'no-circular',
      comment: 'Circular dependencies are strictly forbidden',
      severity: 'error',
      from: {},
      to: {
        circular: true,
      },
    },
  ],
  options: {
    doNotFollow: {
      path: 'node_modules',
    },
    tsConfig: {
      fileName: 'tsconfig.base.json',
    },
  },
};
