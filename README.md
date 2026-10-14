# BLACKBOX-X

> **Deterministic Discrete-Event Simulation, Capacity Modeling & Failure Prediction Platform**  
> High-fidelity discrete-event queueing engine designed to model distributed microservice architectures, resource saturation, network degradation, and cascading failure propagation under variable production workloads.

> [!IMPORTANT]
> ### 🌐 DIRECT LIVE WEB DASHBOARDS (CLICK TO OPEN IN BROWSER)
> - 🖥️ **SYSTEM-X Ecosystem Portal (Blackbox Simulation Tab)**: 👉 **[http://localhost:8080](http://localhost:8080)**  
> - 🛒 **Commerce Reliability Testbed (Calibration & KS Overlays)**: 👉 **[http://localhost:4200](http://localhost:4200)**  

---

## 1. Executive Summary

BLACKBOX-X answers the fundamental distributed systems question: **"What should happen?"**

It provides an analytical and discrete-event simulation framework that models request lifecycles, service times, queueing delays, CPU/thread contention, and network partition degradation without running expensive, destructive live infrastructure experiments.

When paired with **QUORUM LAB** and **SYSTEM-X**, BLACKBOX-X provides the theoretical baseline against which real distributed execution is verified using non-parametric statistical hypothesis testing.

---

## 2. Architecture & Simulation Engine

```text
                  +-----------------------------------+
                  |      WORKLOAD SPECIFICATION       |
                  |     (Poisson, Constant, Zipfian)  |
                  +-----------------+-----------------+
                                    |
                                    v
                  +-----------------------------------+
                  |      VIRTUAL TIME SCHEDULER       |
                  |    (Monotonic Event Calendar)     |
                  +-----------------+-----------------+
                                    |
        +---------------------------+---------------------------+
        |                           |                           |
        v                           v                           v
+-------------------+       +-------------------+       +-------------------+
|  BOUNDED QUEUES   |       |  RESOURCE POOLS   |       |  NETWORK TOPOLOGY |
| (Tail Drop /      |       | (CPU Saturation,  |       | (Latency Jitter,  |
|  Backpressure)    |       |  Thread Starve)   |       |  Partitions)      |
+-------------------+       +-------------------+       +-------------------+
        |                           |                           |
        +---------------------------+---------------------------+
                                    |
                                    v
                  +-----------------------------------+
                  |      STATISTICAL VERIFICATION     |
                  |   • Kolmogorov-Smirnov Test (KS)  |
                  |   • 1-Wasserstein Distance (EMD)  |
                  |   • P50 / P95 / P99 Divergence    |
                  +-----------------------------------+
```

### Core Engine Capabilities
1. **Discrete-Event Virtual Time Engine**: Nanosecond-precision virtual clock scheduling independent of wall-clock jitter, ensuring 100% reproducible execution traces given the same master seed.
2. **Queueing Theory Models ($M/M/c$, $M/G/c$)**: Mathematical simulation of service arrival rates ($\lambda$), mean service rates ($\mu$), queue lengths ($L_q$), and wait times ($W_q$) under Kingman's heavy-traffic approximation.
3. **Chaos & Failure Propagation Engine**: Deterministic injection of network partitions, packet loss, transmission latency, process crashes, and thread pool exhaustion.
4. **Closed-Loop Calibration**: Automated parameter fitting using a **70% training / 30% held-out validation** temporal split with strict zero data-leakage enforcement.
5. **Two-Gate Statistical Divergence Pipeline**: Evaluates empirical vs. simulated distributions using:
   - Two-sample Kolmogorov-Smirnov test: $D_{KS} \le 0.15, p \ge 0.05$
   - 1-Wasserstein (Earth Mover's) distance: $W_1 \le 12.0\text{ ms}$

---

## 3. Package & Monorepo Structure

```text
BLACKBOX-X/
├── apps/
│   └── blackbox-api/           # Fastify HTTP REST API with OpenTelemetry tracing
├── packages/
│   ├── simulation-engine/      # Virtual-clock event calendar & discrete-event runtime
│   ├── statistics/             # Kolmogorov-Smirnov, 1-Wasserstein, & percentile estimators
│   ├── chaos-engine/           # Deterministic fault schedule & failure propagation
│   ├── calibration/            # 70/30 zero-leakage parameter tuning optimizer
│   ├── capacity-search/        # Automated maximum throughput & saturation discovery
│   ├── workload-spec/          # Zipfian, Poisson, & uniform request trace compilers
│   ├── domain/                 # Service topology DAG, node descriptors, & dependency graphs
│   ├── load-orchestrator/      # Multi-client concurrent load generators
│   ├── execution-leases/       # Distributed fencing & node lease management
│   ├── contracts/              # Strict TypeScript schemas & telemetry interfaces
│   ├── config-server/          # Environment configuration & dynamic flag provider
│   ├── logging/                # Structured Pino logging with trace correlation
│   ├── observability/          # OpenTelemetry metric exporters & Jaeger tracing
│   ├── security/               # HMAC authentication & cryptographic token validation
│   └── storage/                # MinIO / AWS S3 artifact storage with SHA-256 validation
├── tests/
│   └── gates/                  # Milestone verification gates (M0 through M12)
└── docs/                       # Architecture diagrams and milestone sign-off reports
```

---

## 4. Milestone Gates (M0 through M12)

BLACKBOX-X is validated against 13 strict architectural milestone gates:
- **M0**: Foundation & Security Boundary (Zero mock adapters, dependency cruiser clean).
- **M1**: Virtual Clock & Event Calendar Scheduler.
- **M2**: Bounded Queue Networks & Backpressure Propagation.
- **M3**: Multi-Core Worker Pool & Resource Contention.
- **M4**: Network Topology & Distributed Jitter Models.
- **M5**: Workload Generators (Poisson arrivals, Zipfian key access).
- **M6**: Chaos Engine & Cascading Failure Propagation.
- **M7**: Non-Parametric Statistical Hypothesis Testing (KS & Wasserstein).
- **M8**: Closed-Loop Calibration with Zero Data Leakage.
- **M9**: Capacity Search & Saturation Knee Detection.
- **M10**: OpenTelemetry Distributed Tracing & Metric Emission.
- **M11**: Cryptographic Artifact Lineage & WORM Storage.
- **M12**: Production Parity Architecture Sign-Off.

---

## 5. Live Testing & Verification

### Running Unit & Simulation Tests
To execute all 14 test suites and 64 tests verifying analytical models and virtual-clock schedules:
```bash
npm run test:unit
```

### Running Gate Verifications
```bash
# Verify foundation & dependency rules
npm run verify:m0

# Verify simulation engine and virtual time
npm run verify:m1
```

### Launching the Blackbox API Service
```bash
# Start Fastify REST API on port 4000
npm run dev --filter=@blackbox-x/api
```

---

## 6. Integration with SYSTEM-X & CRT

1. **Model Baseline for SYSTEM-X**: BLACKBOX-X outputs simulated CDF distributions that SYSTEM-X directly compares against empirical QUORUM LAB measurements during closed-loop verification runs.
2. **Topology Synthesis for CRT**: The 1,000-product Zipfian access distribution in the Commerce Reliability Testbed is calibrated against Blackbox analytical saturation predictions.
