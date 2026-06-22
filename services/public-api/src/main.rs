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
    http_client: reqwest::Client,
    chat_service_url: String,
}

#[derive(Deserialize)]
struct SendMessageRequest {
    text: String,
}

#[derive(Deserialize)]
struct ChatResponse {
    members: Vec<String>,
}

#[derive(Serialize)]
struct MessageSentEvent {
    chat_id: u32,
    text: String,
    sender_id: String,
    // NOTE: Large groups (1000+ members) inflate the Kafka payload. Broker default
    // limit is 1 MB per message (message.max.bytes). Revisit fan-out strategy
    // for very large chats (e.g. separate topic, paging, or chat-level routing).
    recipient_ids: Vec<String>,
}

#[tokio::main]
async fn main() {
    let chat_service_url =
        std::env::var("CHAT_SERVICE_URL").unwrap_or_else(|_| "http://chat:8085".into());

    let http_client = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .expect("failed to create HTTP client");

    let state = AppState {
        producer: create_producer(),
        http_client,
        chat_service_url,
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
    let members = fetch_chat_members(&state, chat_id).await?;

    if !members.contains(&SENDER_ID.to_string()) {
        return Err(StatusCode::FORBIDDEN);
    }

    let event = MessageSentEvent {
        chat_id,
        text: body.text,
        sender_id: SENDER_ID.to_string(),
        recipient_ids: members,
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

async fn fetch_chat_members(state: &AppState, chat_id: u32) -> Result<Vec<String>, StatusCode> {
    let url = format!(
        "{}/chats/{chat_id}",
        state.chat_service_url.trim_end_matches('/')
    );

    let response = state.http_client.get(&url).send().await.map_err(|error| {
        eprintln!("failed to call chat service for chat_id={chat_id}: {error}");
        StatusCode::BAD_GATEWAY
    })?;

    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Err(StatusCode::NOT_FOUND);
    }

    if !response.status().is_success() {
        eprintln!(
            "chat service returned {} for chat_id={chat_id}",
            response.status()
        );
        return Err(StatusCode::BAD_GATEWAY);
    }

    response
        .json::<ChatResponse>()
        .await
        .map_err(|error| {
            eprintln!("failed to decode chat service response for chat_id={chat_id}: {error}");
            StatusCode::BAD_GATEWAY
        })
        .map(|chat| chat.members)
}
