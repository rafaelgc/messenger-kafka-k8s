use axum::{
    http::{header::AUTHORIZATION, HeaderValue, Method},
    routing::get,
    Router,
};
use rdkafka::{
    config::ClientConfig,
    producer::FutureProducer,
};
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tower_http::cors::CorsLayer;

mod authentications;
mod auth;
mod chats;
mod messages;
mod telemetry;
mod topics;
mod users;

#[derive(Clone)]
pub(crate) struct AppState {
    pub(crate) producer: FutureProducer,
    pub(crate) http_client: reqwest::Client,
    pub(crate) chat_service_url: String,
    pub(crate) storage_service_url: String,
    pub(crate) users_service_url: String,
    pub(crate) jwt_secret: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub(crate) struct ChatMember {
    pub(crate) id: String,
    pub(crate) nickname: String,
}

#[derive(Serialize, Deserialize)]
pub(crate) struct PaginationMeta {
    pub(crate) has_more: bool,
    pub(crate) next_cursor: Option<String>,
}

#[tokio::main]
async fn main() {
    let telemetry = telemetry::TelemetryGuard::init();

    let chat_service_url =
        std::env::var("CHAT_SERVICE_URL").unwrap_or_else(|_| "http://chat:8085".into());
    let storage_service_url = std::env::var("STORAGE_SERVICE_URL")
        .unwrap_or_else(|_| "http://message-storage:8087".into());
    let users_service_url =
        std::env::var("USERS_SERVICE_URL").unwrap_or_else(|_| "http://users:8088".into());
    let jwt_secret = std::env::var("JWT_SECRET")
        .unwrap_or_else(|_| "dev-jwt-secret-change-in-production".into());

    let http_client = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .expect("failed to create HTTP client");

    let state = AppState {
        producer: create_producer(),
        http_client,
        chat_service_url,
        storage_service_url,
        users_service_url,
        jwt_secret,
    };

    let cors_origin = std::env::var("CORS_ALLOWED_ORIGIN")
        .unwrap_or_else(|_| "http://localhost:3000".into());
    let cors = CorsLayer::new()
        .allow_origin(
            cors_origin
                .parse::<HeaderValue>()
                .expect("CORS_ALLOWED_ORIGIN must be a valid header value"),
        )
        .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
        .allow_headers([AUTHORIZATION, axum::http::header::CONTENT_TYPE]);

    // [TODO] Add GET /health (200 OK) for ALB/Kubernetes health checks; point the ingress
    // healthcheck-path annotation at /health instead of relying on GET /.
    let app = Router::new()
        .route("/", get(home))
        .merge(users::router())
        .merge(authentications::router())
        .merge(chats::router())
        .merge(messages::router())
        .with_state(state)
        .layer(cors)
        .layer(telemetry::http_trace_layer());

    let bind_addr =
        std::env::var("PUBLIC_API_BIND_ADDR").unwrap_or_else(|_| "0.0.0.0:8080".into());
    let listener = tokio::net::TcpListener::bind(&bind_addr).await.unwrap();

    tracing::info!("public-api listening on {bind_addr}");

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .unwrap();

    telemetry.shutdown();
}

async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("failed to listen for ctrl-c");
    };

    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("failed to listen for SIGTERM")
            .recv()
            .await;
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
}

fn create_producer() -> FutureProducer {
    let brokers = std::env::var("KAFKA_BROKERS").expect("KAFKA_BROKERS must be set");

    ClientConfig::new()
        .set("bootstrap.servers", &brokers)
        .set("message.timeout.ms", "5000")
        .create()
        .expect("failed to create Kafka producer")
}

async fn home() -> String {
    let pod_name = std::env::var("POD_NAME").unwrap_or_else(|_| "unknown".into());
    format!("Hello, World! {}", pod_name)
}
