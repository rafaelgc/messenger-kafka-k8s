mod authentications;
mod telemetry;
mod users;

use mongodb::bson::doc;
use mongodb::bson::oid::ObjectId;
use mongodb::options::IndexOptions;
use mongodb::{Collection, IndexModel};
use serde::{Deserialize, Serialize};

pub(crate) const USERS_COLLECTION: &str = "users";

#[derive(Clone)]
pub(crate) struct AppState {
    collection: Collection<UserDocument>,
    jwt_secret: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub(crate) struct UserDocument {
    #[serde(rename = "_id", skip_serializing_if = "Option::is_none")]
    id: Option<ObjectId>,
    nickname: String,
    password_hash: String,
}

#[tokio::main]
async fn main() {
    let telemetry = telemetry::TelemetryGuard::init();

    let jwt_secret = std::env::var("JWT_SECRET").expect("JWT_SECRET must be set");
    let collection = create_collection().await;
    ensure_nickname_index(&collection).await;

    let state = AppState {
        collection,
        jwt_secret,
    };

    // [TODO] Add GET /health (200 OK) for ALB/Kubernetes health checks; point the ingress
    // healthcheck-path annotation at /health instead of relying on GET /.
    let app = users::router()
        .merge(authentications::router())
        .with_state(state)
        .layer(telemetry::http_trace_layer());

    let bind_addr = std::env::var("USERS_BIND_ADDR").unwrap_or_else(|_| "0.0.0.0:8088".into());
    let listener = tokio::net::TcpListener::bind(&bind_addr).await.unwrap();

    tracing::info!("users service listening on {bind_addr}");

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

async fn create_collection() -> Collection<UserDocument> {
    let uri = std::env::var("MONGODB_URI").expect("MONGODB_URI must be set");
    let database_name = std::env::var("MONGODB_DATABASE").expect("MONGODB_DATABASE must be set");

    let client = mongodb::Client::with_uri_str(&uri)
        .await
        .expect("failed to connect to MongoDB");

    client.database(&database_name).collection(USERS_COLLECTION)
}

async fn ensure_nickname_index(collection: &Collection<UserDocument>) {
    let index = IndexModel::builder()
        .keys(doc! { "nickname": 1 })
        .options(IndexOptions::builder().unique(true).build())
        .build();

    if let Err(error) = collection.create_index(index).await {
        eprintln!("failed to ensure unique nickname index: {error}");
    }
}
