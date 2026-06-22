use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{get, post},
    Router,
};
use rdkafka::{
    config::ClientConfig,
    producer::{FutureProducer, FutureRecord},
};
use std::time::Duration;

mod topics;

#[derive(Clone)]
struct AppState {
    producer: FutureProducer,
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
) -> Result<StatusCode, StatusCode> {
    let payload = format!(r#"{{"chat_id":{chat_id}}}"#);
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
