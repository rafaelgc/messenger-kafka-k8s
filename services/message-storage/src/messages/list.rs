use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use futures::TryStreamExt;
use mongodb::bson::{doc, oid::ObjectId};
use mongodb::options::FindOptions;
use serde::{Deserialize, Serialize};
use tracing::Instrument;

use crate::{AppState, StoredMessage};

const DEFAULT_LIMIT: u32 = 20;
const MAX_LIMIT: u32 = 100;

#[derive(Deserialize)]
pub(crate) struct ListMessagesQuery {
    limit: Option<u32>,
    before: Option<String>,
}

#[derive(Serialize)]
struct MessageItem {
    id: String,
    chat_id: String,
    text: String,
    sender_id: String,
}

#[derive(Serialize)]
pub(crate) struct PaginatedMessagesResponse {
    messages: Vec<MessageItem>,
    pagination: PaginationMeta,
}

#[derive(Serialize)]
struct PaginationMeta {
    has_more: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    next_cursor: Option<String>,
}

pub(crate) async fn list_messages(
    State(state): State<AppState>,
    Path(chat_id): Path<String>,
    Query(query): Query<ListMessagesQuery>,
) -> Result<Json<PaginatedMessagesResponse>, StatusCode> {
    let limit = query.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);
    let fetch_limit = (limit + 1) as i64;

    let mut filter = doc! { "chat_id": &chat_id };

    if let Some(before) = &query.before {
        let before_id = ObjectId::parse_str(before).map_err(|error| {
            eprintln!("invalid pagination cursor for chat_id={chat_id}: {error}");
            StatusCode::BAD_REQUEST
        })?;
        filter.insert("_id", doc! { "$lt": before_id });
    }

    let options = FindOptions::builder()
        .sort(doc! { "_id": -1 })
        .limit(fetch_limit)
        .build();

    // Span covers find + cursor collect so Tempo shows Mongo wait vs HTTP overhead.
    let mut messages = async {
        let result = async {
            let cursor = state
                .collection
                .find(filter)
                .with_options(options)
                .await
                .map_err(|error| {
                    eprintln!("failed to query messages for chat_id={chat_id}: {error}");
                    StatusCode::INTERNAL_SERVER_ERROR
                })?;

            cursor
                .try_collect::<Vec<StoredMessage>>()
                .await
                .map_err(|error| {
                    eprintln!("failed to read messages for chat_id={chat_id}: {error}");
                    StatusCode::INTERNAL_SERVER_ERROR
                })
        }
        .await;

        let span = tracing::Span::current();
        match &result {
            Ok(rows) => {
                span.record("db.query.result_count", rows.len());
                span.record("otel.status_code", "OK");
            }
            Err(_) => {
                span.record("otel.status_code", "ERROR");
                span.record("otel.status_description", "mongodb find/collect failed");
            }
        }
        result
    }
    .instrument(tracing::info_span!(
        "db.query",
        otel.name = "messages.find",
        otel.status_code = tracing::field::Empty,
        otel.status_description = tracing::field::Empty,
        db.system = "mongodb",
        db.operation = "find",
        db.mongodb.collection = "messages",
        messaging.chat_id = %chat_id,
        db.query.limit = fetch_limit,
        db.query.result_count = tracing::field::Empty,
    ))
    .await?;

    let has_more = messages.len() > limit as usize;
    if has_more {
        messages.truncate(limit as usize);
    }

    messages.reverse();

    let next_cursor = if has_more {
        messages
            .first()
            .and_then(|message| message.id.map(|id| id.to_hex()))
    } else {
        None
    };

    let messages = messages
        .into_iter()
        .map(|message| {
            let id = message
                .id
                .expect("stored message must have _id")
                .to_hex();

            MessageItem {
                id,
                chat_id: message.chat_id,
                text: message.text,
                sender_id: message.sender_id,
            }
        })
        .collect();

    Ok(Json(PaginatedMessagesResponse {
        messages,
        pagination: PaginationMeta {
            has_more,
            next_cursor,
        },
    }))
}
