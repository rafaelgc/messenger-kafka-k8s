use axum::{
    extract::{Query, State},
    http::StatusCode,
    Json,
};
use futures::TryStreamExt;
use mongodb::bson::{doc, oid::ObjectId};
use mongodb::options::FindOptions;
use serde::{Deserialize, Serialize};

use crate::{AppState, ChatMember, StoredChat};

const DEFAULT_LIMIT: u32 = 20;
const MAX_LIMIT: u32 = 100;

#[derive(Deserialize)]
pub(crate) struct ListChatsQuery {
    member_id: String,
    limit: Option<u32>,
    before: Option<String>,
}

#[derive(Serialize)]
struct ChatListItem {
    id: String,
    name: String,
    members: Vec<ChatMember>,
}

#[derive(Serialize)]
pub(crate) struct PaginatedChatsResponse {
    chats: Vec<ChatListItem>,
    pagination: PaginationMeta,
}

#[derive(Serialize)]
struct PaginationMeta {
    has_more: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    next_cursor: Option<String>,
}

pub(crate) async fn list_chats(
    State(state): State<AppState>,
    Query(query): Query<ListChatsQuery>,
) -> Result<Json<PaginatedChatsResponse>, StatusCode> {
    if query.member_id.trim().is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }

    let limit = query.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);
    let fetch_limit = (limit + 1) as i64;

    let mut filter = doc! { "members.id": &query.member_id };

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
