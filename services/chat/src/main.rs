use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    routing::get,
    Json, Router,
};
use futures::TryStreamExt;
use mongodb::bson::{doc, oid::ObjectId};
use mongodb::options::FindOptions;
use mongodb::{Collection, IndexModel};
use serde::{Deserialize, Serialize};

const CHATS_COLLECTION: &str = "chats";
const DEFAULT_LIMIT: u32 = 20;
const MAX_LIMIT: u32 = 100;

#[derive(Clone)]
struct AppState {
    collection: Collection<StoredChat>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct StoredChat {
    #[serde(rename = "_id")]
    id: ObjectId,
    name: String,
    members: Vec<String>,
}

#[derive(Serialize)]
struct ChatResponse {
    name: String,
    members: Vec<String>,
}

#[derive(Serialize)]
struct ChatListItem {
    id: String,
    name: String,
    members: Vec<String>,
}

#[derive(Serialize)]
struct PaginatedChatsResponse {
    chats: Vec<ChatListItem>,
    pagination: PaginationMeta,
}

#[derive(Serialize)]
struct PaginationMeta {
    has_more: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    next_cursor: Option<String>,
}

#[derive(Deserialize)]
struct ListChatsQuery {
    member_id: String,
    limit: Option<u32>,
    before: Option<String>,
}

#[tokio::main]
async fn main() {
    let collection = create_collection().await;
    ensure_members_index(&collection).await;

    let state = AppState { collection };

    let app = Router::new()
        .route("/chats", get(list_chats))
        .route("/chats/{id}", get(get_chat))
        .with_state(state);

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
        .keys(doc! { "members": 1 })
        .build();

    if let Err(error) = collection.create_index(index).await {
        eprintln!("failed to ensure members index: {error}");
    }
}

async fn list_chats(
    State(state): State<AppState>,
    Query(query): Query<ListChatsQuery>,
) -> Result<Json<PaginatedChatsResponse>, StatusCode> {
    if query.member_id.trim().is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }

    let limit = query.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);
    let fetch_limit = (limit + 1) as i64;

    let mut filter = doc! { "members": &query.member_id };

    if let Some(before) = &query.before {
        let before_id = ObjectId::parse_str(before).map_err(|error| {
            eprintln!(
                "invalid pagination cursor for member_id={}: {error}",
                query.member_id
            );
            StatusCode::BAD_REQUEST
        })?;
        filter.insert("_id", doc! { "$lt": before_id });
    }

    let options = FindOptions::builder()
        .sort(doc! { "_id": -1 })
        .limit(fetch_limit)
        .build();

    let cursor = state
        .collection
        .find(filter)
        .with_options(options)
        .await
        .map_err(|error| {
            eprintln!(
                "failed to query chats for member_id={}: {error}",
                query.member_id
            );
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    let mut chats = cursor
        .try_collect::<Vec<StoredChat>>()
        .await
        .map_err(|error| {
            eprintln!(
                "failed to read chats for member_id={}: {error}",
                query.member_id
            );
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    let has_more = chats.len() > limit as usize;
    if has_more {
        chats.truncate(limit as usize);
    }

    let next_cursor = if has_more {
        chats.last().map(|chat| chat.id.to_hex())
    } else {
        None
    };

    let chats = chats
        .into_iter()
        .map(|chat| ChatListItem {
            id: chat.id.to_hex(),
            name: chat.name,
            members: chat.members,
        })
        .collect();

    Ok(Json(PaginatedChatsResponse {
        chats,
        pagination: PaginationMeta {
            has_more,
            next_cursor,
        },
    }))
}

async fn get_chat(
    State(state): State<AppState>,
    Path(chat_id): Path<String>,
) -> Result<Json<ChatResponse>, StatusCode> {
    let object_id = ObjectId::parse_str(&chat_id).map_err(|error| {
        eprintln!("invalid chat id {chat_id}: {error}");
        StatusCode::BAD_REQUEST
    })?;

    let chat = state
        .collection
        .find_one(doc! { "_id": object_id })
        .await
        .map_err(|error| {
            eprintln!("failed to load chat {chat_id}: {error}");
            StatusCode::INTERNAL_SERVER_ERROR
        })?
        .ok_or(StatusCode::NOT_FOUND)?;

    Ok(Json(ChatResponse {
        name: chat.name,
        members: chat.members,
    }))
}
