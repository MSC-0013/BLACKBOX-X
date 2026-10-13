# BLACKBOX-X

> **Discrete-Event Simulation, Capacity Modeling & Failure Prediction Engine**  
> High-fidelity discrete-event queuing and simulation system designed to model distributed microservice architectures, resource bottlenecks, and cascading failure modes under variable traffic workloads.

---

## 🏛️ Architecture Overview

BLACKBOX-X provides mathematical modeling and deterministic simulation for distributed systems:

```text
                  ┌───────────────────────────────┐
                  │    Workload Specification     │
                  │   (Poisson, Constant, Zipf)   │
                  └───────────────┬───────────────┘
                                  │
                                  ▼
                  ┌───────────────────────────────┐
                  │      Simulation Runner        │
                  │   (Virtual Clock Scheduling)  │
                  └───────────────┬───────────────┘
                                  │
           ┌──────────────────────┼──────────────────────┐
           ▼                      ▼                      ▼
  Bounded Queues         Worker Thread Pools      Network Delays
 (Drop / Backpressure)    (Core Saturation)     (Jitter & Latency)
           │                      │                      │
           └──────────────────────┼──────────────────────┘
                                  ▼
                  ┌───────────────────────────────┐
                  │   Statistical Verification    │
                  │ (Kolmogorov-Smirnov Test,     │
                  │  Wasserstein Earth Mover's)   │
                  └───────────────────────────────┘
```

---

## 📦 Packages & Modules

- **`@blackbox-x/simulation-engine`**: Virtual-clock discrete-event simulation scheduler, bounded queuing networks, resource contention models, and deterministic PRNG.
- **`@blackbox-x/statistics`**: Non-parametric hypothesis testing, two-sample Kolmogorov-Smirnov test, Wasserstein-1 (Earth Mover's) distance metric, and percentile divergence estimators.
- **`@blackbox-x/chaos-engine`**: Deterministic fault generation (packet drops, latency spikes, process brownouts, network partitions).
- **`@blackbox-x/calibration`**: Closed-loop parameter optimization with temporal data partitioning (70% calibration / 30% held-out validation) for zero-leakage model alignment.
- **`@blackbox-x/contracts`**: Immutable type contracts and schema definitions for distributed workloads and telemetry traces.
- **`@blackbox-x/storage`**: S3/MinIO artifact archival with cryptographic SHA-256 validation.

---

## 🚀 Tech Stack

- **Runtime:** Node.js 24 LTS, TypeScript 5.8 (Strict Mode)
- **Monorepo:** Turborepo, pnpm workspaces
- **Messaging & Streaming:** Apache Kafka, Redis
- **Storage:** MinIO / AWS S3, MySQL
- **Observability:** OpenTelemetry distributed tracing, Prometheus metrics
- **Testing:** Vitest

---

## 🛠️ Getting Started

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run unit and integration tests
pnpm test
```
