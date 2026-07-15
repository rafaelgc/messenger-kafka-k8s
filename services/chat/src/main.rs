mod chats;

use mongodb::bson::{doc, oid::ObjectId};
use mongodb::{Collection, IndexModel};
use serde::{Deserialize, Serialize};

const CHATS_COLLECTION: &str = "chats";

#[derive(Clone)]
pub(crate) struct AppState {
    collection: Collection<StoredChat>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub(crate) struct ChatMember {
    id: String,
    nickname: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub(crate) struct StoredChat {
    #[serde(rename = "_id")]
    id: ObjectId,
    name: String,
    creator: ChatMember,
    members: Vec<ChatMember>,
}

#[tokio::main]
async fn main() {
    let collection = create_collection().await;
    ensure_members_index(&collection).await;

    let state = AppState { collection };

    // [TODO] Add GET /health (200 OK) for ALB/Kubernetes health checks; point the ingress
    // healthcheck-path annotation at /health instead of relying on GET /.
    let app = chats::router().with_state(state);

    let bind_addr = std::env::var("CHAT_BIND_ADDR").unwrap_or_else(|_| "0.0.0.0:8085".into());
    let listener = tokio::net::TcpListener::bind(&bind_addr).await.unwrap();

    println!("chat service listening on {bind_addr}");

    axum::serve(listener, app).await.unwrap();
}

async fn create_collection() -> Collection<StoredChat> {
    let uri = std::env::var("MONGODB_URI").expect("MONGODB_URI must be set");
    let database_name = std::env::var("MONGODB_DATABASE").expect("MONGODB_DATABASE must be set");

    let client = mongodb::Client::with_uri_str(&uri)
        .await
        .expect("failed to connect to MongoDB");

    client.database(&database_name).collection(CHATS_COLLECTION)
}

async fn ensure_members_index(collection: &Collection<StoredChat>) {
    let index = IndexModel::builder()
        .keys(doc! { "members.id": 1 })
        .build();

    if let Err(error) = collection.create_index(index).await {
        eprintln!("failed to ensure members index: {error}");
    }
}
