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
