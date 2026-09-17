import { Kafka, Producer, Admin } from 'kafkajs';
import { randomUUID } from 'node:crypto';
import type { LoadCommand, LoadCommandType } from '../types.js';

export interface KafkaCommanderOptions {
  brokers: string[];
  clientId?: string;
  commandTopic?: string;
}

export class KafkaLoadCommander {
  private kafka: Kafka;
  private producer: Producer;
  private admin: Admin;
  private commandTopic: string;
  private connected = false;

  constructor(options: KafkaCommanderOptions) {
    this.kafka = new Kafka({
      clientId: options.clientId ?? `load-commander-${randomUUID().slice(0, 8)}`,
      brokers: options.brokers,
      retry: { retries: 5 },
    });
    this.producer = this.kafka.producer();
    this.admin = this.kafka.admin();
    this.commandTopic = options.commandTopic ?? 'load-commands.v1';
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    await this.admin.connect();
    await this.producer.connect();
    this.connected = true;
  }

  async ensureTopics(topics: string[] = [this.commandTopic]): Promise<void> {
    if (!this.connected) await this.connect();
    const existingTopics = await this.admin.listTopics();
    const missing = topics.filter((t) => !existingTopics.includes(t));
    if (missing.length > 0) {
      await this.admin.createTopics({
        topics: missing.map((topic) => ({
          topic,
          numPartitions: 3,
          replicationFactor: 1,
        })),
        waitForLeaders: true,
      });
    }
  }

  async sendCommand(
    type: LoadCommandType,
    runId: string,
    payload: {
      targetUrl?: string;
      targetRps?: number;
      durationSec?: number;
      pattern?: 'CONSTANT' | 'POISSON' | 'RAMP' | 'BURST';
      concurrency?: number;
      assignedWorkers?: string[];
    } = {},
  ): Promise<LoadCommand> {
    if (!this.connected) await this.connect();

    const command: LoadCommand = {
      commandId: randomUUID(),
      type,
      runId,
      targetUrl: payload.targetUrl ?? '',
      targetRps: payload.targetRps ?? 100,
      durationSec: payload.durationSec ?? 10,
      pattern: payload.pattern ?? 'CONSTANT',
      concurrency: payload.concurrency ?? 5,
      timestamp: new Date().toISOString(),
      assignedWorkers: payload.assignedWorkers,
    };

    await this.producer.send({
      topic: this.commandTopic,
      messages: [
        {
          key: runId,
          value: JSON.stringify(command),
          headers: {
            'command-type': type,
            'run-id': runId,
          },
        },
      ],
    });

    return command;
  }

  async sendStartLoad(params: {
    runId: string;
    targetUrl: string;
    targetRps: number;
    durationSec: number;
    pattern?: 'CONSTANT' | 'POISSON' | 'RAMP' | 'BURST';
    concurrency?: number;
    assignedWorkers?: string[];
  }): Promise<LoadCommand> {
    return this.sendCommand('START_LOAD', params.runId, params);
  }

  async sendStopLoad(runId: string): Promise<LoadCommand> {
    return this.sendCommand('STOP_LOAD', runId);
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;
    await this.producer.disconnect();
    await this.admin.disconnect();
    this.connected = false;
  }
}
