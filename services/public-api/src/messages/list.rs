use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use serde::{Deserialize, Serialize};

use crate::{auth, chats, telemetry, AppState, PaginationMeta};

#[derive(Serialize, Deserialize)]
struct MessageItem {
    id: String,
    chat_id: String,
    text: String,
    sender_id: String,
}

#[derive(Serialize, Deserialize)]
pub(crate) struct PaginatedMessagesResponse {
    messages: Vec<MessageItem>,
    pagination: PaginationMeta,
}

#[derive(Deserialize, Serialize)]
pub(crate) struct ListMessagesQuery {
    #[serde(skip_serializing_if = "Option::is_none")]
    limit: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    before: Option<String>,
}

// NOTE: Membership is checked at request time only. Storage returns every message
// in the chat — there is no per-user history. Users who leave cannot access past
// messages; users who join later see the full chat history.
pub(crate) async fn list_messages(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(chat_id): Path<String>,
    Query(query): Query<ListMessagesQuery>,
) -> Result<Json<PaginatedMessagesResponse>, StatusCode> {
    let user_id = auth::authenticate_request(&headers, &state.jwt_secret)?;
    let members = chats::fetch_chat_members(&state, &chat_id).await?;

    if !members.iter().any(|member| member.id == user_id) {
        return Err(StatusCode::FORBIDDEN);
    }

    let url = format!(
        "{}/chats/{chat_id}/messages",
        state.storage_service_url.trim_end_matches('/')
    );

    let response = telemetry::traced_execute(
        &state.http_client,
        state.http_client.get(&url).query(&query),
        "message-storage.list_messages",
        "message-storage",
    )
    .await
    .map_err(|error| {
        eprintln!("failed to call storage service for chat_id={chat_id}: {error}");
        StatusCode::BAD_GATEWAY
    })?;

    if response.status() == reqwest::StatusCode::BAD_REQUEST {
        return Err(StatusCode::BAD_REQUEST);
    }

    if !response.status().is_success() {
        eprintln!(
            "storage service returned {} for chat_id={chat_id}",
            response.status()
        );
        return Err(StatusCode::BAD_GATEWAY);
    }

    response
        .json::<PaginatedMessagesResponse>()
        .await
        .map_err(|error| {
            eprintln!("failed to decode storage service response for chat_id={chat_id}: {error}");
            StatusCode::BAD_GATEWAY
        })
        .map(Json)
}
