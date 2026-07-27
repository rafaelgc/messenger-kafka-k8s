use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    Json,
};
use serde::{Deserialize, Serialize};

use crate::{auth, telemetry, users, AppState, ChatMember};

use super::CreateChatResponse;

#[derive(Deserialize)]
pub(crate) struct CreateChatRequest {
    member_nicknames: Vec<String>,
    #[serde(default)]
    name: String,
}

#[derive(Serialize)]
struct CreateChatForwardRequest {
    creator: ChatMember,
    name: String,
    members: Vec<ChatMember>,
}

#[derive(Serialize)]
pub(crate) struct ErrorBody {
    error: String,
}

type CreateChatError = (StatusCode, Json<ErrorBody>);

fn err(status: StatusCode, message: impl Into<String>) -> CreateChatError {
    (status, Json(ErrorBody { error: message.into() }))
}

pub(crate) async fn create_chat(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<CreateChatRequest>,
) -> Result<(StatusCode, Json<CreateChatResponse>), CreateChatError> {
    let claims = auth::authenticate_user(&headers, &state.jwt_secret)
        .map_err(|status| err(status, "authentication required"))?;

    if body.member_nicknames.is_empty() {
        return Err(err(
            StatusCode::BAD_REQUEST,
            "member_nicknames must not be empty",
        ));
    }

    let mut seen_nicknames = std::collections::HashSet::new();
    for nickname in &body.member_nicknames {
        if nickname.trim().is_empty() || !seen_nicknames.insert(nickname) {
            return Err(err(
                StatusCode::BAD_REQUEST,
                "member_nicknames must be unique and non-empty",
            ));
        }

        if nickname == &claims.nickname {
            return Err(err(
                StatusCode::BAD_REQUEST,
                "member_nicknames must not include your own nickname",
            ));
        }
    }

    if body.member_nicknames.len() > 1 && body.name.trim().is_empty() {
        return Err(err(
            StatusCode::BAD_REQUEST,
            "group chats require a non-empty name",
        ));
    }

    let mut members = Vec::with_capacity(body.member_nicknames.len());
    for nickname in &body.member_nicknames {
        let user = match users::lookup_user_by_nickname(&state, nickname).await {
            Ok(user) => user,
            Err(StatusCode::NOT_FOUND) => {
                return Err(err(
                    StatusCode::NOT_FOUND,
                    format!("user not found: {nickname}"),
                ));
            }
            Err(status) => {
                return Err(err(
                    status,
                    format!("failed to look up user: {nickname}"),
                ));
            }
        };
        members.push(ChatMember {
            id: user.id,
            nickname: user.nickname,
        });
    }

    let url = format!("{}/chats", state.chat_service_url.trim_end_matches('/'));

    let response = telemetry::traced_execute(
        &state.http_client,
        state.http_client.post(&url).json(&CreateChatForwardRequest {
            creator: ChatMember {
                id: claims.sub,
                nickname: claims.nickname,
            },
            name: body.name,
            members,
        }),
        "chat.create",
        "chat",
    )
    .await
    .map_err(|error| {
        eprintln!("failed to call chat service to create chat: {error}");
        err(StatusCode::BAD_GATEWAY, "chat service unavailable")
    })?;

    let status = response.status();
    if status == reqwest::StatusCode::BAD_REQUEST {
        return Err(err(StatusCode::BAD_REQUEST, "invalid chat request"));
    }

    if status == reqwest::StatusCode::CONFLICT {
        return Err(err(
            StatusCode::CONFLICT,
            "a direct chat with that person already exists",
        ));
    }

    if !status.is_success() {
        eprintln!("chat service returned {status} when creating chat");
        return Err(err(StatusCode::BAD_GATEWAY, "chat service error"));
    }

    response
        .json::<CreateChatResponse>()
        .await
        .map_err(|error| {
            eprintln!("failed to decode chat service create response: {error}");
            err(
                StatusCode::BAD_GATEWAY,
                "invalid response from chat service",
            )
        })
        .map(|chat| (StatusCode::CREATED, Json(chat)))
}
