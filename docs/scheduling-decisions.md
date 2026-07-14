# EKS scheduling decisions

Production scheduling choices for the messenger cluster: cost (spot vs on-demand), replica counts, and availability-zone spread. These decisions interact — read both sections before changing replicas or node groups.

**Related config:**

- Node groups: `infra/lib/messenger-stack.ts`
- Prod patches: `k8s/overlays/prod/` (`spot-patch.yaml`, `*-az-spread-patch.yaml`, `mongodb-mongos-az-spread-patch.yaml`)

---

## Stateless workloads on Spot instances

### Decision

Run **stateless** application tiers on a dedicated **Spot** node group. Keep **stateful** and long-lived-connection workloads on **on-demand** nodes.

Spot scheduling is opt-in per Deployment via the label `scheduling.messenger/spot: "true"`. The prod overlay applies `spot-patch.yaml` to those Deployments, which adds:

1. A **toleration** for the spot node taint (`capacity-type=spot:NoSchedule`).
2. **Required node affinity** for `eks.amazonaws.com/capacityType=SPOT`, so spot-labelled pods cannot land on on-demand nodes.

The spot node group is **tainted** in CDK so that, by default, nothing schedules there unless it explicitly opts in. On-demand nodes remain the safe default for everything else.

### Workloads on Spot (prod)

| Service | Notes |
|---------|--------|
| `public-api` | HTTP API |
| `frontend` | Next.js |
| `chat` (app) | Stateless app tier |
| `users` (app) | Stateless app tier |
| `message-storage` (app) | Stateless app tier |
| `mongodb-mongos` | Router only; data lives on on-demand shards |
| `kafka-ui`, `mongo-express` | Dev/debug UIs |
| Grafana | Trace UI; stateless, datasources from ConfigMap |
| `message-delivery` | WebSocket fan-out; per-pod Kafka groups; frontend reconnects on drop |

### Workloads on on-demand

| Service | Reason to stay on-demand |
|---------|--------------------------|
| Kafka | Persistent volume; broker identity and log data |
| MongoDB shards, config servers | Persistent volumes; replica set stability |
| Embedded MongoDB (`chat-mongodb`, `users-mongodb`) | Persistent volumes |
| Tempo | Trace storage (PVC) |

Grafana and `message-delivery` run on Spot (stateless / reconnectable; brief outage on interruption is acceptable). Tempo stays on-demand (PVC-backed trace storage). Delivery uses per-pod Kafka consumer groups so all replicas see every event; the frontend reconnects on disconnect but should refetch chat history after reconnect ([TODO]).

Migration is gradual: new stateless services get the spot label when they are ready; stateful tiers stay put unless there is a deliberate redesign.

### Why Spot for stateless services

- **Cost.** Spot instances are typically much cheaper than on-demand for the same instance family. Stateless HTTP/API/frontends tolerate occasional node loss: Kubernetes reschedules pods, the ALB health-checks new endpoints, and traffic recovers within a rollout window.
- **Clear separation.** The taint + opt-in label prevents accidental placement of databases or Kafka on interruptible hardware.
- **Autoscaler-friendly pool.** Spot scales independently (`minSize` / `maxSize` on the spot node group) without mixing interruptible capacity into the on-demand pool used for data.

### Why not run stateful services on Spot

Spot instances can be **terminated with short notice** (typically two minutes on EKS). That is acceptable for stateless pods; it is a poor fit for stateful systems:

1. **Persistent volumes.** Stateful pods bind to EBS volumes in a specific AZ. A spot interruption evicts the pod; recovery depends on rescheduling in the same AZ, reattaching the volume, and restarting processes. Frequent interruptions increase crash recovery, fsck risk, and operational noise without saving meaningful compute on idle disk-bound workloads.

2. **Data durability and consistency.** Kafka brokers, MongoDB replica set members, and embedded MongoDB instances assume relatively stable process lifetime. Forced restarts during replication or elections can prolong unavailability and, under bad timing, contribute to split-brain or lag scenarios that are expensive to debug.

3. **Long-lived connections.** Spot eviction drops WebSocket sessions; clients must reconnect (implemented in the frontend). Acceptable for `message-delivery` with per-pod Kafka fan-out and post-reconnect refetch ([TODO]).

4. **Operational predictability.** On-demand nodes for the data plane make capacity planning and incident response simpler: the “things that must not flap” pool is separate from the “cheap and replaceable” pool.

**Exception in this design:** `mongodb-mongos` runs on Spot because it is a **stateless query router**. Shard data and config still live on on-demand nodes; losing a mongos pod is similar to losing an app replica.

---

## Availability-zone spread

We use two different spread models in prod. They answer different HA questions.

| Model | Services today | HA rule | Max replicas (2 AZ) |
|-------|----------------|---------|---------------------|
| **Strict one-per-zone** | `public-api`, `message-storage`, `chat`, `users`, `frontend` | At most one pod per AZ | Capped at **2** |
| **Min two zones** | `mongodb-mongos`, `message-delivery` | At least two AZs must have pods; multiple pods per AZ OK | **Not** capped at 2 |

---

### Strict one-per-zone (most services)

Prod applies **required** pod anti-affinity on `topology.kubernetes.io/zone`:

```yaml
podAntiAffinity:
  requiredDuringSchedulingIgnoredDuringExecution:
    - labelSelector:
        matchLabels:
          app.kubernetes.io/name: <service>
      topologyKey: topology.kubernetes.io/zone
```

**Behavior:** at most **one pod of this service per zone.**

With two zones, the scheduler can place **at most two replicas** — one in each AZ. That gives zone-level redundancy: a single AZ outage should not take out every replica.

If you set `replicas: 3` with this policy unchanged:

- Two pods schedule (one per zone).
- The third pod stays **Pending** forever — no third zone exists, and anti-affinity forbids a second pod in either zone.

**Rollout caveat:** default rolling update (`maxSurge: 1`) tries to run a third pod before removing old ones. With both zones already occupied, that pod cannot schedule. Workarounds until these services migrate: `maxSurge: 0` / `maxUnavailable: 1`, or delete stale ReplicaSets after a stuck rollout.

**Cluster Autoscaler:** a pod that **can** schedule (even in the “wrong” zone) will not trigger scale-up. Required anti-affinity helps CA when the pod stays Pending — but only if CA can add a node in the right zone (see infrastructure notes below).

---

### Min two zones — `mongodb-mongos` (target model)

`mongodb-mongos` uses **`topologySpreadConstraints`** in `mongodb-mongos-az-spread-patch.yaml` instead of required anti-affinity:

```yaml
topologySpreadConstraints:
  - maxSkew: 1
    minDomains: 2
    topologyKey: topology.kubernetes.io/zone
    whenUnsatisfiable: DoNotSchedule
    labelSelector:
      matchLabels:
        app.kubernetes.io/name: mongodb-mongos
    matchLabelKeys:
      - pod-template-hash
```

**Behavior in plain language:**

1. **HA:** mongos must run in **at least two AZs**. A layout with all pods in a single zone is never allowed (`minDomains: 2`, `DoNotSchedule`).
2. **Scale:** extra replicas **may share an AZ** (e.g. two in `us-east-2a`, one in `us-east-2b`) as long as another AZ also has at least one pod. Replication is **not** limited to the number of zones.
3. **Rollouts:** `matchLabelKeys: [pod-template-hash]` lets old and new ReplicaSet pods count as separate groups, so a new version may briefly sit in the same AZ as the one it replaces during a rolling update — no special `strategy` block required.
4. **Cluster Autoscaler:** if the only schedulable option would violate the spread rule (e.g. zone B full, would stack everything in A), the pod stays **Pending** so CA can add capacity in the other zone instead of accepting single-AZ placement.

**Examples (2 AZ):**

| Layout | Allowed? |
|--------|----------|
| A:1, B:1 | Yes |
| A:2, B:2 | Yes |
| A:2, B:1 | Yes |
| A:4, B:0 | No — not HA across zones |

This is the model we intend to migrate other HA services to when we touch their spread patches.

---

### Two replicas (most services)

Most HA-facing Deployments still use **`replicas: 2`**, not 3 or higher, because of the **strict one-per-zone** rule above — not because of a fundamental cluster limit.

With **2 AZ + strict spread:** treat **`replicas: 2` as the maximum** for Deployments using `*-az-spread-patch.yaml`.

With **2 AZ + min-two-zones spread** (mongos): you can run **more than two replicas**; the constraint is “present in ≥2 AZs,” not “one per zone.”

---

### Known limitations — should be improved

1. **Migrate remaining services** from required anti-affinity to `topologySpreadConstraints` + `minDomains: 2` + `matchLabelKeys` (mongos is the pilot).
2. **Add a third AZ** to the cluster and node groups for three-way zone redundancy (`replicas: 3` with one pod per zone, or more with min-two-zones spread).
3. **Per-AZ node groups** (or `minSize: 1` per zone) so Cluster Autoscaler can scale the correct zone when spread rules leave pods Pending. A single multi-AZ ASG simulates scale-up poorly with zone constraints.
4. **Hostname spread** for on-demand stateful workloads so Kafka, config, and observability do not pile onto one node (the scheduler does not rebalance existing pods automatically).
5. **Upgrade Cluster Autoscaler** to match the EKS Kubernetes version (currently a version skew vs 1.35).

**Soft spread (`preferred` anti-affinity / `ScheduleAnyway`) is not recommended** for HA services we expect CA to protect: the scheduler will colocate pods when convenient, and CA never scales to fix “undesired but valid” placement.

---

## Quick reference

```text
                    ┌─────────────────────────────────────┐
                    │  On-demand node group               │
                    │  Kafka, MongoDB, Tempo,             │
                    │  embedded MongoDB                   │
                    └─────────────────────────────────────┘

                    ┌─────────────────────────────────────┐
                    │  Spot node group (tainted)          │
                    │  public-api, frontend, chat, users, │
                    │  message-storage, message-delivery, │
                    │  UIs, Grafana, mongos               │
                    │  (min-2-zones spread)               │
                    └─────────────────────────────────────┘
```

| Question | Answer |
|----------|--------|
| Can I run 3 replicas of `public-api`? | Not with current **strict** AZ spread and 2 AZs — one pod will stay Pending. |
| Can I run 3 replicas of `mongodb-mongos`? | Yes, with **min-two-zones** spread (e.g. 2+1 across AZs). |
| Can I put Kafka on Spot? | Not recommended; persistent state and interruption risk. |
| How does a service opt into Spot? | Label Deployment `scheduling.messenger/spot: "true"`; deploy prod overlay. |
| Does Kubernetes rebalance overloaded nodes? | No — spread rules only affect **new** scheduling; use rollout restart or Descheduler to fix existing pile-up. |
| Why did mongos rollouts get stuck before? | Strict one-per-zone + default `maxSurge` tried a third pod with both zones full. Min-two-zones + `matchLabelKeys` avoids that. |
