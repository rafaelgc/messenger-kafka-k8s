# Messaging Distributed System

A distributed, scalable messaging platform built as a set of Docker services orchestrated with Docker Compose. Services communicate through Kafka event streaming; persistence and push token storage use dedicated MongoDB instances.

## Architecture

When a message is sent, the Public API publishes a `message.sent` event to Kafka. Three consumers react to that event independently:

- **Message Storage** persists the message in MongoDB.
- **Message Delivery** pushes it in real time to connected clients over WebSocket.
- **Message Push** sends a notification to offline users via a push connector.

## Services

### Infrastructure

| Service | Description |
|---|---|
| **kafka** | Event broker (`soldevelo/kafka`, Bitnami-compatible). All services publish and consume through Kafka. Runs in KRaft mode (no Zookeeper). |
| **kafka-init** | One-shot container that creates the `message.sent` topic on startup, then exits. Not a second broker — it ensures the topic exists before application services start. |
| **kafka-ui** | Web UI for browsing topics, messages, and consumer groups. Available at http://localhost:8082 |
| **storage-mongodb** | MongoDB instance dedicated to the Message Storage service. |
| **storage-mongo-express** | Web UI for `storage-mongodb`. Available at http://localhost:8083 |
| **push-mongodb** | MongoDB instance dedicated to the Message Push service (device tokens for Google/Apple notifications). |
| **push-mongo-express** | Web UI for `push-mongodb`. Available at http://localhost:8084 |
| **chat-mongodb** | MongoDB instance dedicated to the Chat service. |
| **chat-mongo-express** | Web UI for `chat-mongodb`. Available at http://localhost:8086 |
| **users-mongodb** | MongoDB instance dedicated to the Users service. |
| **users-mongo-express** | Web UI for `users-mongodb`. Available at http://localhost:8089 |

### Application

| Service | Language | Port | Description |
|---|---|---|---|
| **public-api** | Rust | 8080 | Public HTTP API. Accepts client requests and publishes `message.sent` events. |
| **chat** | Rust | 8085 | Chat metadata API. Returns chat members and related attributes. |
| **users** | Rust | — | User registration and authentication. Issues JWT tokens. Internal only — exposed via `public-api`. |
| **message-storage** | Rust | — | Consumes `message.sent` and stores message payloads in `storage-mongodb`. |
| **message-delivery** | Rust | 8081 | Maintains WebSocket connections with online clients. Consumes `message.sent` and delivers messages in real time. |
| **message-push** | Rust | — | Consumes `message.sent` and sends push notifications to offline users. Stores device tokens in `push-mongodb`. Uses a dummy connector for now (no real Google/Apple integration). |
| **frontend** | Next.js | 3000 | Web UI. Dev server with hot reload via `npm run dev`. Available at http://localhost:3000 |

## Getting started

No Rust toolchain is required on the host — everything runs in Docker.

```bash
docker compose up
```

Infrastructure services (Kafka, MongoDB) start first, then the application services.

### Development workflow

Application services use a shared dev image (`services/Dockerfile.dev`) with:

- **Bind mounts** — your source code at `services/<name>/` is mounted into the container
- **`cargo watch`** — rebuilds and restarts automatically when `src/` or `Cargo.toml` changes
- **Cached volumes** — `target/` and the Cargo registry persist between restarts, so dependency builds are not repeated

Edit code on the host; the running container picks up changes without rebuilding the image.

The **frontend** service uses `node:22.15.0-alpine` with the `frontend/` directory bind-mounted. On first run, install dependencies inside the container:

```bash
docker compose run --rm frontend npm install
docker compose up frontend
```

See `.env.example` for configurable environment variables.

### Local Kubernetes

Manifests live under `k8s/` (Kustomize base + `overlays/local` and `overlays/prod`). The overlay deploys application services only; the cluster still needs platform add-ons (ingress controller, MongoDB operator).

**Prerequisites:** a running cluster (Docker Desktop Kubernetes or kind), `kubectl`, and `helm`.

After creating or resetting a cluster, install those add-ons once:

```bash
./scripts/setup-local-cluster.sh
```

The script checks cluster connectivity, installs **ingress-nginx**, and installs the **MongoDB Community Operator** (with CRDs). It is safe to re-run if a component is already present.

Then deploy the app:

```bash
kubectl apply -k k8s/overlays/local
```

Services are exposed via host-based ingress — for example `http://app.localhost` for the frontend (not `http://localhost:3000`). See comments in `k8s/base/ingress.yaml` for all routes and DNS notes.

### Deploying to AWS (EKS)

Infrastructure is defined in `infra/` (AWS CDK). Application manifests are under `k8s/overlays/prod`. The CDK container (`infra/Dockerfile`) bundles the CDK CLI, AWS CLI, and `kubectl` so you do not need them installed on the host.

**Prerequisites**

- Docker
- AWS credentials configured on the **host** (`aws configure`, SSO, or environment variables). The container reads them from `~/.aws` at runtime — configure AWS on the host first, then mount that directory into the container.

Run all commands below from the **repository root**.

#### Step 1. Build the CDK container image

```bash
docker build -t cdk-cli -f infra/Dockerfile infra
```

Verify:

```bash
docker run --rm cdk-cli --version
```

#### Step 2. Preview infrastructure changes (`cdk diff`)

```bash
docker run --rm \
  -v "$PWD/infra:/workspace" \
  -v ~/.aws:/root/.aws:ro \
  -w /workspace \
  cdk-cli diff
```

To create or update the EKS cluster, use the same mounts with `deploy` instead of `diff`:

```bash
docker run --rm -it \
  -v "$PWD/infra:/workspace" \
  -v ~/.aws:/root/.aws:ro \
  -w /workspace \
  cdk-cli deploy
```

After deploy, configure `kubectl` for the new cluster (on the host or inside a container shell):

```bash
aws eks update-kubeconfig --name <cluster-name> --region <region>
```

CDK also installs the **Amazon EBS CSI driver** addon and a default **`gp3` StorageClass** so PersistentVolumeClaims can provision EBS volumes. If you deployed the app before this was in place, delete stuck Pending PVCs and re-apply the overlay:

```bash
kubectl delete pvc --all -A
kubectl apply -k k8s/overlays/prod
```

(`WaitForFirstConsumer` binding is normal: PVCs stay Pending until a pod that uses them is scheduled.)

#### Step 3. Build and push images to ECR

EKS nodes pull application images from Amazon ECR. Build every service image and push it:

```bash
./scripts/build-images.sh --all --push-ecr
```

Requires AWS credentials and a configured region (`AWS_REGION` or `aws configure`). The script creates ECR repositories if needed (one per service name) and pushes tags such as `<account>.dkr.ecr.<region>.amazonaws.com/users:latest`.

For the frontend, set `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_WS_URL` to your production API and WebSocket URLs before building (see `.env.example`). EKS nodes are ARM64 (`t4g.large`); images built on Apple Silicon match that architecture automatically.

Point the prod Kubernetes manifests at ECR (otherwise Kubernetes treats names like `frontend:latest` as Docker Hub):

```bash
./scripts/configure-prod-ecr.sh
```

This rewrites `k8s/overlays/prod/ecr/kustomization.yaml` with your registry host. EKS worker nodes already use their IAM role to pull from ECR in the same account — no `imagePullSecrets` needed.

#### Step 4. Deploy the application (`kubectl apply`)

Install cluster add-ons once (MongoDB operator; skip ingress-nginx on EKS — the ALB controller is installed by CDK):

```bash
./scripts/setup-local-cluster.sh --skip-ingress-nginx
```

Deploy manifests:

```bash
kubectl apply -k k8s/overlays/prod
```

Or run `kubectl` from the CDK container (mount the repo, AWS creds, and kubeconfig):

```bash
docker run --rm \
  -v "$PWD:/repo" \
  -v ~/.aws:/root/.aws:ro \
  -v ~/.kube:/root/.kube:ro \
  -w /repo \
  --entrypoint kubectl \
  cdk-cli apply -k k8s/overlays/prod
```

Before going live, set production hostnames in `k8s/overlays/prod/hosts-configmap.yaml`, then point DNS at the ALB (`kubectl get ingress messaging -o wide`).

**Teardown:** delete the Ingress (or the whole prod overlay) and wait for the ALB to be removed **before** `cdk destroy`, or subnet deletion may fail.

### Production images

Each service also has a multi-stage `services/<name>/Dockerfile` for production or CI builds. Those compile a release binary into a minimal runtime image and are not used by `docker compose up`.
