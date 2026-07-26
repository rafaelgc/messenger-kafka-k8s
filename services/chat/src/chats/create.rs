use axum::{extract::State, http::StatusCode, Json};
use mongodb::bson::{doc, oid::ObjectId};
use mongodb::error::{Error, ErrorKind, WriteError, WriteFailure};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

use crate::{AppState, ChatMember, StoredChat};

#[derive(Deserialize)]
pub(crate) struct CreateChatRequest {
    creator: ChatMember,
    name: String,
    members: Vec<ChatMember>,
}

#[derive(Serialize)]
pub(crate) struct CreateChatResponse {
    id: String,
    name: String,
    creator: ChatMember,
    members: Vec<ChatMember>,
}

pub(crate) async fn create_chat(
    State(state): State<AppState>,
    Json(request): Json<CreateChatRequest>,
) -> Result<(StatusCode, Json<CreateChatResponse>), StatusCode> {
    if request.creator.id.trim().is_empty() || request.creator.nickname.trim().is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }

    if request.members.is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }

    let mut seen_member_ids = HashSet::new();
    for member in std::iter::once(&request.creator).chain(request.members.iter()) {
        if member.id.trim().is_empty() || member.nickname.trim().is_empty() {
            return Err(StatusCode::BAD_REQUEST);
        }

        if !seen_member_ids.insert(&member.id) {
            return Err(StatusCode::BAD_REQUEST);
        }
    }

    let creator = request.creator.clone();

    let mut members = request.members;
    members.push(creator.clone());
    members.sort_by(|left, right| left.id.cmp(&right.id));

    let (name, direct_key) = if members.len() == 2 {
        (
            direct_message_name(&members),
            Some(direct_key(&members[0].id, &members[1].id)),
        )
    } else {
        if request.name.trim().is_empty() {
            return Err(StatusCode::BAD_REQUEST);
        }

        (request.name.trim().to_owned(), None)
    };

    let chat = StoredChat {
        id: ObjectId::new(),
        name,
        creator,
        members,
        direct_key,
    };

    state.collection.insert_one(&chat).await.map_err(|error| {
        if chat.direct_key.is_some() && is_duplicate_key_error(&error) {
            eprintln!(
                "direct chat already exists for direct_key={}",
                chat.direct_key.as_deref().unwrap_or("")
            );
            return StatusCode::CONFLICT;
        }

        eprintln!("failed to create chat: {error}");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    Ok((
        StatusCode::CREATED,
        Json(CreateChatResponse {
            id: chat.id.to_hex(),
            name: chat.name,
            creator: chat.creator,
            members: chat.members,
        }),
    ))
}

fn direct_message_name(members: &[ChatMember]) -> String {
    format!("{} & {}", members[0].nickname, members[1].nickname)
}

/// Builds the DM uniqueness key: sorted ids joined with `:`.
/// Same pair always produces the same string regardless of who initiated the chat.
fn direct_key(member_id_smaller: &str, member_id_larger: &str) -> String {
    format!("{member_id_smaller}:{member_id_larger}")
}

fn is_duplicate_key_error(error: &Error) -> bool {
    matches!(
        error.kind.as_ref(),
        ErrorKind::Write(WriteFailure::WriteError(WriteError { code: 11000, .. }))
    )
}
