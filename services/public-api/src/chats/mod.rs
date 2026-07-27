mod create;
mod list;

use axum::{http::StatusCode, routing::get, Router};
use serde::{Deserialize, Serialize};

use crate::{telemetry, AppState, ChatMember, PaginationMeta};

pub(crate) fn router() -> Router<AppState> {
    Router::new().route("/chats", get(list::list_chats).post(create::create_chat))
}

#[derive(Serialize, Deserialize)]
pub(crate) struct ChatListItem {
    id: String,
    name: String,
    creator: ChatMember,
    members: Vec<ChatMember>,
}

#[derive(Serialize, Deserialize)]
pub(crate) struct PaginatedChatsResponse {
    chats: Vec<ChatListItem>,
    pagination: PaginationMeta,
}

#[derive(Serialize, Deserialize)]
pub(crate) struct CreateChatResponse {
    id: String,
    name: String,
    creator: ChatMember,
    members: Vec<ChatMember>,
}

#[derive(Deserialize)]
struct ChatResponse {
    #[allow(dead_code)]
    name: String,
    #[allow(dead_code)]
    creator: ChatMember,
    members: Vec<ChatMember>,
}

pub(crate) async fn fetch_chat_members(
    state: &AppState,
    chat_id: &str,
) -> Result<Vec<ChatMember>, StatusCode> {
    let url = format!(
        "{}/chats/{chat_id}",
        state.chat_service_url.trim_end_matches('/')
    );

    let response = telemetry::traced_execute(
        &state.http_client,
        state.http_client.get(&url),
        "chat.get",
        "chat",
    )
    .await
    .map_err(|error| {
        eprintln!("failed to call chat service for chat_id={chat_id}: {error}");
        StatusCode::BAD_GATEWAY
    })?;

    if response.status() == reqwest::StatusCode::BAD_REQUEST {
        return Err(StatusCode::BAD_REQUEST);
    }

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
