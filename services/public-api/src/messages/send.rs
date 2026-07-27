use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use rdkafka::producer::FutureRecord;
use serde::{Deserialize, Serialize};
use std::time::Duration;

use crate::{auth, chats, topics, AppState};

#[derive(Deserialize)]
pub(crate) struct SendMessageRequest {
    text: String,
}

#[derive(Serialize)]
struct MessageSentEvent {
    chat_id: String,
    text: String,
    sender_id: String,
    // NOTE: Large groups (1000+ members) inflate the Kafka payload. Broker default
    // limit is 1 MB per message (message.max.bytes). Revisit fan-out strategy
    // for very large chats (e.g. separate topic, paging, or chat-level routing).
    recipient_ids: Vec<String>,
}

pub(crate) async fn send_message(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(chat_id): Path<String>,
    Json(body): Json<SendMessageRequest>,
) -> Result<StatusCode, StatusCode> {
    let user_id = auth::authenticate_request(&headers, &state.jwt_secret)?;
    let members = chats::fetch_chat_members(&state, &chat_id).await?;

    if !members.iter().any(|member| member.id == user_id) {
        return Err(StatusCode::FORBIDDEN);
    }

    let key = chat_id.clone();

    let event = MessageSentEvent {
        chat_id,
        text: body.text,
        sender_id: user_id,
        recipient_ids: members.into_iter().map(|member| member.id).collect(),
    };

    let payload = serde_json::to_string(&event).map_err(|error| {
        eprintln!("failed to serialize message.sent event: {error}");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    // [TODO][TRACING] Inject W3C traceparent into Kafka message headers (and wrap publish
    // in a kafka.publish span) so message-storage consume spans link as parent-child.
    state
        .producer
        .send(
            FutureRecord::to(topics::MESSAGE_SENT)
                .key(&key)
                .payload(&payload),
            Duration::from_secs(5),
        )
        .await
        .map_err(|(error, _)| {
            eprintln!("failed to publish message.sent event: {error}");
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    Ok(StatusCode::CREATED)
}
