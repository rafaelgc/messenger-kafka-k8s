mod kafka;
mod messages;
mod telemetry;
mod topics;

use mongodb::Collection;
use serde::{Deserialize, Serialize};

const MESSAGES_COLLECTION: &str = "messages";

#[derive(Clone)]
pub(crate) struct AppState {
    collection: Collection<StoredMessage>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub(crate) struct StoredMessage {
    #[serde(rename = "_id", skip_serializing_if = "Option::is_none")]
    id: Option<mongodb::bson::oid::ObjectId>,
    chat_id: String,
    text: String,
    sender_id: String,
}

#[tokio::main]
async fn main() {
    let telemetry = telemetry::TelemetryGuard::init();

    let state = AppState {
        collection: create_collection().await,
    };

    tokio::select! {
        _ = shutdown_signal() => {
            tracing::info!("shutdown signal received");
        }
        result = run_http_server(state.clone()) => {
            if let Err(error) = result {
                eprintln!("http server error: {error}");
            }
        }
        result = kafka::run(state) => {
            if let Err(error) = result {
                eprintln!("kafka consumer error: {error}");
            }
        }
    }

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

async fn run_http_server(state: AppState) -> Result<(), String> {
    let app = messages::router()
        .with_state(state)
        .layer(telemetry::http_trace_layer());

    let bind_addr =
        std::env::var("STORAGE_BIND_ADDR").unwrap_or_else(|_| "0.0.0.0:8087".into());

    let listener = tokio::net::TcpListener::bind(&bind_addr)
        .await
        .map_err(|error| format!("failed to bind http server: {error}"))?;

    tracing::info!("message-storage http server listening on {bind_addr}");

    axum::serve(listener, app)
        .await
        .map_err(|error| format!("http server failed: {error}"))?;

    Ok(())
}

async fn create_collection() -> Collection<StoredMessage> {
    let uri = std::env::var("MONGODB_URI").expect("MONGODB_URI must be set");
    let database_name = std::env::var("MONGODB_DATABASE").expect("MONGODB_DATABASE must be set");

    let client = mongodb::Client::with_uri_str(&uri)
        .await
        .expect("failed to connect to MongoDB");

    client
        .database(&database_name)
        .collection(MESSAGES_COLLECTION)
}
