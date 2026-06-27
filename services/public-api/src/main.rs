use axum::{
    extract::{Path, Query, State},
    http::{header::AUTHORIZATION, HeaderMap, HeaderValue, Method, StatusCode},
    routing::{get, post},
    Json, Router,
};
use jsonwebtoken::{decode, DecodingKey, Validation};
use rdkafka::{
    config::ClientConfig,
    producer::{FutureProducer, FutureRecord},
};
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tower_http::cors::CorsLayer;

mod topics;

#[derive(Clone)]
struct AppState {
    producer: FutureProducer,
    http_client: reqwest::Client,
    chat_service_url: String,
    storage_service_url: String,
    users_service_url: String,
    jwt_secret: String,
}

#[derive(Serialize, Deserialize)]
struct MessageItem {
    id: String,
    chat_id: String,
    text: String,
    sender_id: String,
}

#[derive(Serialize, Deserialize)]
struct PaginatedMessagesResponse {
    messages: Vec<MessageItem>,
    pagination: PaginationMeta,
}

#[derive(Serialize, Deserialize)]
struct PaginationMeta {
    has_more: bool,
    next_cursor: Option<String>,
}

#[derive(Deserialize, Serialize)]
struct ListMessagesQuery {
    #[serde(skip_serializing_if = "Option::is_none")]
    limit: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    before: Option<String>,
}

#[derive(Deserialize, Serialize)]
struct CreateUserRequest {
    nickname: String,
    password: String,
}

#[derive(Serialize, Deserialize)]
struct CreateUserResponse {
    id: String,
    nickname: String,
}

#[derive(Deserialize, Serialize)]
struct AuthenticateRequest {
    nickname: String,
    password: String,
}

#[derive(Serialize, Deserialize)]
struct AuthenticateResponse {
    token: String,
}

#[derive(Deserialize)]
#[allow(dead_code)]
struct TokenClaims {
    sub: String,
    nickname: String,
    exp: usize,
}

#[derive(Deserialize)]
struct SendMessageRequest {
    text: String,
}

#[derive(Deserialize)]
struct CreateChatRequest {
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

#[derive(Serialize, Deserialize)]
struct CreateChatResponse {
    id: String,
    name: String,
    creator: ChatMember,
    members: Vec<ChatMember>,
}

#[derive(Deserialize)]
struct GetUserResponse {
    id: String,
    nickname: String,
}

#[derive(Serialize, Deserialize, Clone)]
struct ChatMember {
    id: String,
    nickname: String,
}

#[derive(Deserialize)]
struct ChatResponse {
    #[allow(dead_code)]
    name: String,
    #[allow(dead_code)]
    creator: ChatMember,
    members: Vec<ChatMember>,
}

#[derive(Serialize, Deserialize)]
struct ChatListItem {
    id: String,
    name: String,
    creator: ChatMember,
    members: Vec<ChatMember>,
}

#[derive(Serialize, Deserialize)]
struct PaginatedChatsResponse {
    chats: Vec<ChatListItem>,
    pagination: PaginationMeta,
}

#[derive(Deserialize, Serialize)]
struct ListChatsQuery {
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

#[tokio::main]
async fn main() {
    let chat_service_url =
        std::env::var("CHAT_SERVICE_URL").unwrap_or_else(|_| "http://chat:8085".into());
    let storage_service_url = std::env::var("STORAGE_SERVICE_URL")
        .unwrap_or_else(|_| "http://message-storage:8087".into());
    let users_service_url =
        std::env::var("USERS_SERVICE_URL").unwrap_or_else(|_| "http://users:8088".into());
    let jwt_secret = std::env::var("JWT_SECRET")
        .unwrap_or_else(|_| "dev-jwt-secret-change-in-production".into());

    let http_client = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .expect("failed to create HTTP client");

    let state = AppState {
        producer: create_producer(),
        http_client,
        chat_service_url,
        storage_service_url,
        users_service_url,
        jwt_secret,
    };

    let cors_origin = std::env::var("CORS_ALLOWED_ORIGIN")
        .unwrap_or_else(|_| "http://localhost:3000".into());
    let cors = CorsLayer::new()
        .allow_origin(
            cors_origin
                .parse::<HeaderValue>()
                .expect("CORS_ALLOWED_ORIGIN must be a valid header value"),
        )
        .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
        .allow_headers([AUTHORIZATION, axum::http::header::CONTENT_TYPE]);

    let app = Router::new()
        .route("/", get(home))
        .route("/users", post(create_user))
        .route("/authentications", post(authenticate))
        .route("/chats", get(list_chats).post(create_chat))
        .route(
            "/chats/{chat_id}/messages",
            get(list_messages).post(send_message),
        )
        .with_state(state)
        .layer(cors);

    let bind_addr =
        std::env::var("PUBLIC_API_BIND_ADDR").unwrap_or_else(|_| "0.0.0.0:8080".into());
    let listener = tokio::net::TcpListener::bind(&bind_addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

fn create_producer() -> FutureProducer {
    let brokers = std::env::var("KAFKA_BROKERS").expect("KAFKA_BROKERS must be set");

    ClientConfig::new()
        .set("bootstrap.servers", &brokers)
        .set("message.timeout.ms", "5000")
        .create()
        .expect("failed to create Kafka producer")
}

async fn home() -> String {
    let pod_name = std::env::var("POD_NAME").unwrap_or_else(|_| "unknown".into());
    format!("Hello, World! {}", pod_name)
}

async fn create_user(
    State(state): State<AppState>,
    Json(body): Json<CreateUserRequest>,
) -> Result<(StatusCode, Json<CreateUserResponse>), StatusCode> {
    let url = format!(
        "{}/users",
        state.users_service_url.trim_end_matches('/')
    );

    let response = state
        .http_client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|error| {
            eprintln!("failed to call users service to create user: {error}");
            StatusCode::BAD_GATEWAY
        })?;

    let status = response.status();
    if !status.is_success() {
        return Err(upstream_status(status));
    }

    let user = response.json::<CreateUserResponse>().await.map_err(|error| {
        eprintln!("failed to decode users service create response: {error}");
        StatusCode::BAD_GATEWAY
    })?;

    Ok((StatusCode::CREATED, Json(user)))
}

async fn authenticate(
    State(state): State<AppState>,
    Json(body): Json<AuthenticateRequest>,
) -> Result<Json<AuthenticateResponse>, StatusCode> {
    let url = format!(
        "{}/authentications",
        state.users_service_url.trim_end_matches('/')
    );

    let response = state
        .http_client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|error| {
            eprintln!("failed to call users service to authenticate: {error}");
            StatusCode::BAD_GATEWAY
        })?;

    let status = response.status();
    if !status.is_success() {
        return Err(upstream_status(status));
    }

    response
        .json::<AuthenticateResponse>()
        .await
        .map_err(|error| {
            eprintln!("failed to decode users service authentication response: {error}");
            StatusCode::BAD_GATEWAY
        })
        .map(Json)
}

fn upstream_status(status: reqwest::StatusCode) -> StatusCode {
    StatusCode::from_u16(status.as_u16()).unwrap_or(StatusCode::BAD_GATEWAY)
}

async fn list_chats(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<ListChatsQuery>,
) -> Result<Json<PaginatedChatsResponse>, StatusCode> {
    let user_id = authenticate_request(&headers, &state.jwt_secret)?;

    let url = format!(
        "{}/chats",
        state.chat_service_url.trim_end_matches('/')
    );

    let response = state
        .http_client
        .get(&url)
        .query(&ListChatsForwardQuery {
            member_id: user_id,
            limit: query.limit,
            before: query.before,
        })
        .send()
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

async fn create_chat(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<CreateChatRequest>,
) -> Result<(StatusCode, Json<CreateChatResponse>), StatusCode> {
    let claims = authenticate_user(&headers, &state.jwt_secret)?;

    if body.member_nicknames.is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }

    let mut seen_nicknames = std::collections::HashSet::new();
    for nickname in &body.member_nicknames {
        if nickname.trim().is_empty() || !seen_nicknames.insert(nickname) {
            return Err(StatusCode::BAD_REQUEST);
        }

        if nickname == &claims.nickname {
            return Err(StatusCode::BAD_REQUEST);
        }
    }

    if body.member_nicknames.len() > 1 && body.name.trim().is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }

    let mut members = Vec::with_capacity(body.member_nicknames.len());
    for nickname in &body.member_nicknames {
        let user = lookup_user_by_nickname(&state, nickname).await?;
        members.push(ChatMember {
            id: user.id,
            nickname: user.nickname,
        });
    }

    let url = format!(
        "{}/chats",
        state.chat_service_url.trim_end_matches('/')
    );

    let response = state
        .http_client
        .post(&url)
        .json(&CreateChatForwardRequest {
            creator: ChatMember {
                id: claims.sub,
                nickname: claims.nickname,
            },
            name: body.name,
            members,
        })
        .send()
        .await
        .map_err(|error| {
            eprintln!("failed to call chat service to create chat: {error}");
            StatusCode::BAD_GATEWAY
        })?;

    let status = response.status();
    if status == reqwest::StatusCode::BAD_REQUEST {
        return Err(StatusCode::BAD_REQUEST);
    }

    if status == reqwest::StatusCode::CONFLICT {
        return Err(StatusCode::CONFLICT);
    }

    if !status.is_success() {
        eprintln!("chat service returned {status} when creating chat");
        return Err(StatusCode::BAD_GATEWAY);
    }

    response
        .json::<CreateChatResponse>()
        .await
        .map_err(|error| {
            eprintln!("failed to decode chat service create response: {error}");
            StatusCode::BAD_GATEWAY
        })
        .map(|chat| (StatusCode::CREATED, Json(chat)))
}

// NOTE: Membership is checked at request time only. Storage returns every message
// in the chat — there is no per-user history. Users who leave cannot access past
// messages; users who join later see the full chat history.
async fn list_messages(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(chat_id): Path<String>,
    Query(query): Query<ListMessagesQuery>,
) -> Result<Json<PaginatedMessagesResponse>, StatusCode> {
    let user_id = authenticate_request(&headers, &state.jwt_secret)?;
    let members = fetch_chat_members(&state, &chat_id).await?;

    if !members.iter().any(|member| member.id == user_id) {
        return Err(StatusCode::FORBIDDEN);
    }

    let url = format!(
        "{}/chats/{chat_id}/messages",
        state.storage_service_url.trim_end_matches('/')
    );

    let response = state
        .http_client
        .get(&url)
        .query(&query)
        .send()
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
            eprintln!(
                "failed to decode storage service response for chat_id={chat_id}: {error}"
            );
            StatusCode::BAD_GATEWAY
        })
        .map(Json)
}

async fn send_message(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(chat_id): Path<String>,
    Json(body): Json<SendMessageRequest>,
) -> Result<StatusCode, StatusCode> {
    let user_id = authenticate_request(&headers, &state.jwt_secret)?;
    let members = fetch_chat_members(&state, &chat_id).await?;

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

fn authenticate_request(headers: &HeaderMap, jwt_secret: &str) -> Result<String, StatusCode> {
    Ok(authenticate_user(headers, jwt_secret)?.sub)
}

fn authenticate_user(headers: &HeaderMap, jwt_secret: &str) -> Result<TokenClaims, StatusCode> {
    let token = bearer_token(headers)?;
    decode_token(jwt_secret, token)
}

fn bearer_token(headers: &HeaderMap) -> Result<&str, StatusCode> {
    let value = headers
        .get(AUTHORIZATION)
        .ok_or(StatusCode::UNAUTHORIZED)?;
    let value = value.to_str().map_err(|_| StatusCode::UNAUTHORIZED)?;

    value
        .strip_prefix("Bearer ")
        .ok_or(StatusCode::UNAUTHORIZED)
}

fn decode_token(jwt_secret: &str, token: &str) -> Result<TokenClaims, StatusCode> {
    decode::<TokenClaims>(
        token,
        &DecodingKey::from_secret(jwt_secret.as_bytes()),
        &Validation::default(),
    )
    .map(|data| data.claims)
    .map_err(|error| {
        eprintln!("invalid auth token: {error}");
        StatusCode::UNAUTHORIZED
    })
}

async fn fetch_chat_members(state: &AppState, chat_id: &str) -> Result<Vec<ChatMember>, StatusCode> {
    let url = format!(
        "{}/chats/{chat_id}",
        state.chat_service_url.trim_end_matches('/')
    );

    let response = state.http_client.get(&url).send().await.map_err(|error| {
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

async fn lookup_user_by_nickname(
    state: &AppState,
    nickname: &str,
) -> Result<GetUserResponse, StatusCode> {
    let url = format!(
        "{}/users",
        state.users_service_url.trim_end_matches('/')
    );

    let response = state
        .http_client
        .get(&url)
        .query(&[("nickname", nickname)])
        .send()
        .await
        .map_err(|error| {
            eprintln!("failed to call users service for nickname={nickname}: {error}");
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
            "users service returned {} for nickname={nickname}",
            response.status()
        );
        return Err(StatusCode::BAD_GATEWAY);
    }

    response
        .json::<GetUserResponse>()
        .await
        .map_err(|error| {
            eprintln!("failed to decode users service lookup for nickname={nickname}: {error}");
            StatusCode::BAD_GATEWAY
        })
}
