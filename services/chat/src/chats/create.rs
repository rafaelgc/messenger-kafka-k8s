use axum::{extract::State, http::StatusCode, Json};
use mongodb::bson::{doc, oid::ObjectId};
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

    let name = if members.len() == 2 {
        if let Some(existing_chat) =
            find_existing_direct_chat(&state, &members[0].id, &members[1].id).await?
        {
            eprintln!(
                "direct chat already exists for members {} and {}: {}",
                members[0].id,
                members[1].id,
                existing_chat.id.to_hex()
            );
            return Err(StatusCode::CONFLICT);
        }

        direct_message_name(&members)
    } else {
        if request.name.trim().is_empty() {
            return Err(StatusCode::BAD_REQUEST);
        }

        request.name.trim().to_owned()
    };

    let chat = StoredChat {
        id: ObjectId::new(),
        name,
        creator,
        members,
    };

    state.collection.insert_one(&chat).await.map_err(|error| {
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

// 1:1 chats are unique by member pair. This may change if we ever allow multiple
// conversations between the same two users.
async fn find_existing_direct_chat(
    state: &AppState,
    member_id_a: &str,
    member_id_b: &str,
) -> Result<Option<StoredChat>, StatusCode> {
    state
        .collection
        .find_one(doc! {
            "$and": [
                { "members.id": member_id_a },
                { "members.id": member_id_b },
                { "members": { "$size": 2 } },
            ]
        })
        .await
        .map_err(|error| {
            eprintln!(
                "failed to check for existing direct chat between {member_id_a} and {member_id_b}: {error}"
            );
            StatusCode::INTERNAL_SERVER_ERROR
        })
}
