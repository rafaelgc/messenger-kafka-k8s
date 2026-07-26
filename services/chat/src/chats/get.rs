use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use mongodb::bson::{doc, oid::ObjectId};
use serde::Serialize;
use tracing::Instrument;

use crate::{AppState, ChatMember, CHATS_COLLECTION};

#[derive(Serialize)]
pub(crate) struct ChatResponse {
    name: String,
    creator: ChatMember,
    members: Vec<ChatMember>,
}

pub(crate) async fn get_chat(
    State(state): State<AppState>,
    Path(chat_id): Path<String>,
) -> Result<Json<ChatResponse>, StatusCode> {
    let object_id = ObjectId::parse_str(&chat_id).map_err(|error| {
        eprintln!("invalid chat id {chat_id}: {error}");
        StatusCode::BAD_REQUEST
    })?;

    let chat = async {
        state
            .collection
            .find_one(doc! { "_id": object_id })
            .await
            .map_err(|error| {
                eprintln!("failed to load chat {chat_id}: {error}");
                StatusCode::INTERNAL_SERVER_ERROR
            })
    }
    .instrument(tracing::info_span!(
        "db.query",
        otel.name = "chats.find_one",
        db.system = "mongodb",
        db.operation = "find",
        db.mongodb.collection = CHATS_COLLECTION,
        messaging.chat_id = %chat_id,
    ))
    .await?
    .ok_or(StatusCode::NOT_FOUND)?;

    Ok(Json(ChatResponse {
        name: chat.name,
        creator: chat.creator,
        members: chat.members,
    }))
}
