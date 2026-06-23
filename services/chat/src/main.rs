use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::get,
    Json, Router,
};
use mongodb::bson::{doc, oid::ObjectId, Document};
use serde::{Deserialize, Serialize};

const CHATS_COLLECTION: &str = "chats";

#[derive(Clone)]
struct AppState {
    collection: mongodb::Collection<Document>,
}

#[derive(Debug, Deserialize)]
struct ChatDocument {
    members: Vec<String>,
}

#[derive(Serialize)]
struct ChatResponse {
    members: Vec<String>,
}

#[tokio::main]
async fn main() {
    let state = AppState {
        collection: create_collection().await,
    };

    let app = Router::new()
        .route("/chats/{id}", get(get_chat))
        .with_state(state);

    let bind_addr = std::env::var("CHAT_BIND_ADDR").unwrap_or_else(|_| "0.0.0.0:8085".into());
    let listener = tokio::net::TcpListener::bind(&bind_addr).await.unwrap();

    println!("chat service listening on {bind_addr}");

    axum::serve(listener, app).await.unwrap();
}

async fn create_collection() -> mongodb::Collection<Document> {
    let uri = std::env::var("MONGODB_URI").expect("MONGODB_URI must be set");
    let database_name = std::env::var("MONGODB_DATABASE").expect("MONGODB_DATABASE must be set");

    let client = mongodb::Client::with_uri_str(&uri)
        .await
        .expect("failed to connect to MongoDB");

    client.database(&database_name).collection(CHATS_COLLECTION)
}

async fn get_chat(
    State(state): State<AppState>,
    Path(chat_id): Path<String>,
) -> Result<Json<ChatResponse>, StatusCode> {
    let object_id = ObjectId::parse_str(&chat_id).map_err(|error| {
        eprintln!("invalid chat id {chat_id}: {error}");
        StatusCode::BAD_REQUEST
    })?;

    let document = state
        .collection
        .find_one(doc! { "_id": object_id })
        .await
        .map_err(|error| {
            eprintln!("failed to load chat {chat_id}: {error}");
            StatusCode::INTERNAL_SERVER_ERROR
        })?
        .ok_or(StatusCode::NOT_FOUND)?;

    let chat: ChatDocument = mongodb::bson::from_document(document).map_err(|error| {
        eprintln!("failed to decode chat {chat_id}: {error}");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    Ok(Json(ChatResponse {
        members: chat.members,
    }))
}
