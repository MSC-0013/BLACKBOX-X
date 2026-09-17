import { NodeSDK } from '@opentelemetry/sdk-node';
import { Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { serverConfig } from '@blackbox-x/config-server';
import { createLogger } from '@blackbox-x/logging';

const log = createLogger('otel-bootstrap');

const serviceName = process.env.OTEL_SERVICE_NAME || 'blackbox-x';
const serviceVersion = process.env.npm_package_version || '0.1.0';

export const sdk = new NodeSDK({
  resource: new Resource({
    [ATTR_SERVICE_NAME]: serviceName,
    [ATTR_SERVICE_VERSION]: serviceVersion,
    'deployment.environment': serverConfig.NODE_ENV,
  }),
});

let isStarted = false;

export async function startTelemetry(): Promise<void> {
  if (isStarted) return;
  try {
    sdk.start();
    isStarted = true;
    log.info({ serviceName, serviceVersion }, 'OpenTelemetry SDK initialized');
  } catch (err) {
    log.error({ err }, 'Failed to initialize OpenTelemetry SDK');
  }
}

export async function shutdownTelemetry(): Promise<void> {
  if (!isStarted) return;
  try {
    await sdk.shutdown();
    isStarted = false;
    log.info('OpenTelemetry SDK shut down cleanly');
  } catch (err) {
    log.error({ err }, 'Error shutting down OpenTelemetry SDK');
  }
}

// Auto-start when imported via node --import
if (process.env.OTEL_SDK_DISABLED !== 'true') {
  startTelemetry().catch((err) => {
    log.error({ err }, 'Unhandled error starting telemetry');
  });
}
