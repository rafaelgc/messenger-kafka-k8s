use axum::{
    extract::{Query, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use serde::{Deserialize, Serialize};

use crate::{auth, telemetry, AppState};

use super::PaginatedChatsResponse;

#[derive(Deserialize, Serialize)]
pub(crate) struct ListChatsQuery {
    #[serde(skip_serializing_if = "Option::is_none")]
    limit: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    before: Option<String>,
}

#[derive(Serialize)]
struct ListChatsForwardQuery {
    member_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    limit: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    before: Option<String>,
}

pub(crate) async fn list_chats(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<ListChatsQuery>,
) -> Result<Json<PaginatedChatsResponse>, StatusCode> {
    let user_id = auth::authenticate_request(&headers, &state.jwt_secret)?;

    let url = format!("{}/chats", state.chat_service_url.trim_end_matches('/'));

    let response = telemetry::traced_execute(
        &state.http_client,
        state
            .http_client
            .get(&url)
            .query(&ListChatsForwardQuery {
                member_id: user_id,
                limit: query.limit,
                before: query.before,
            }),
        "chat.list",
        "chat",
    )
    .await
    .map_err(|error| {
        eprintln!("failed to call chat service to list chats: {error}");
        StatusCode::BAD_GATEWAY
    })?;

    if response.status() == reqwest::StatusCode::BAD_REQUEST {
        return Err(StatusCode::BAD_REQUEST);
    }

    if !response.status().is_success() {
        eprintln!(
            "chat service returned {} when listing chats",
            response.status()
        );
        return Err(StatusCode::BAD_GATEWAY);
    }

    response
        .json::<PaginatedChatsResponse>()
        .await
        .map_err(|error| {
            eprintln!("failed to decode chat service list response: {error}");
            StatusCode::BAD_GATEWAY
        })
        .map(Json)
}
