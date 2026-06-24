use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use mongodb::bson::{doc, oid::ObjectId};
use serde::Serialize;

use crate::{AppState, ChatMember};

#[derive(Serialize)]
pub(crate) struct ChatResponse {
    name: String,
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
