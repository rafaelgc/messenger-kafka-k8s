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

### Production images

Each service also has a multi-stage `services/<name>/Dockerfile` for production or CI builds. Those compile a release binary into a minimal runtime image and are not used by `docker compose up`.

See `.env.example` for configurable environment variables.
