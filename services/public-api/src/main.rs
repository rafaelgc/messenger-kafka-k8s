use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use rdkafka::{
    config::ClientConfig,
    producer::{FutureProducer, FutureRecord},
};
use serde::{Deserialize, Serialize};
use std::time::Duration;

mod topics;

const SENDER_ID: &str = "dummy_id";

#[derive(Clone)]
struct AppState {
    producer: FutureProducer,
}

#[derive(Deserialize)]
struct SendMessageRequest {
    text: String,
}

#[derive(Serialize)]
struct MessageSentEvent<'a> {
    chat_id: u32,
    text: &'a str,
    sender_id: &'a str,
}

#[tokio::main]
async fn main() {
    let state = AppState {
        producer: create_producer(),
    };

    let app = Router::new()
        .route("/", get(home))
        .route("/chats/{chat_id}/messages", post(send_message))
        .with_state(state);

    let bind_addr =
        std::env::var("PUBLIC_API_BIND_ADDR").unwrap_or_else(|_| "0.0.0.0:8080".into());
    let listener = tokio::net::TcpListener::bind(&bind_addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

fn create_producer() -> FutureProducer {
    let brokers = std::env::var("KAFKA_BROKERS").expect("KAFKA_BROKERS must be set");

    ClientConfig::new()
        .set("bootstrap.servers", &brokers)
        .set("message.timeout.ms", "5000")
        .create()
        .expect("failed to create Kafka producer")
}

async fn home() -> &'static str {
    "Hello, World!"
}

async fn send_message(
    State(state): State<AppState>,
    Path(chat_id): Path<u32>,
    Json(body): Json<SendMessageRequest>,
) -> Result<StatusCode, StatusCode> {
    let event = MessageSentEvent {
        chat_id,
        text: &body.text,
        sender_id: SENDER_ID,
    };

    let payload = serde_json::to_string(&event).map_err(|error| {
        eprintln!("failed to serialize message.sent event: {error}");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    let key = chat_id.to_string();

    state
        .producer
        .send(
            FutureRecord::to(topics::MESSAGE_SENT)
                .key(&key)
                .payload(&payload),
            Duration::from_secs(5),
        )
        .await
        .map_err(|(error, _)| {
            eprintln!("failed to publish message.sent event: {error}");
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    Ok(StatusCode::CREATED)
}
