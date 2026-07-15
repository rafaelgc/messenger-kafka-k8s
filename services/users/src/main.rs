use argon2::{
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use axum::{
    extract::{Query, State},
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use chrono::{Duration, Utc};
use jsonwebtoken::{encode, EncodingKey, Header};
use mongodb::bson::{doc, oid::ObjectId};
use mongodb::error::{Error, ErrorKind, WriteError, WriteFailure};
use mongodb::options::IndexOptions;
use mongodb::{Collection, IndexModel};
use rand_core::OsRng;
use serde::{Deserialize, Serialize};

const USERS_COLLECTION: &str = "users";
const TOKEN_TTL_HOURS: i64 = 24;

#[derive(Clone)]
struct AppState {
    collection: Collection<UserDocument>,
    jwt_secret: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct UserDocument {
    #[serde(rename = "_id", skip_serializing_if = "Option::is_none")]
    id: Option<ObjectId>,
    nickname: String,
    password_hash: String,
}

#[derive(Deserialize)]
struct CreateUserRequest {
    nickname: String,
    password: String,
}

#[derive(Serialize)]
struct CreateUserResponse {
    id: String,
    nickname: String,
}

#[derive(Deserialize)]
struct AuthenticateRequest {
    nickname: String,
    password: String,
}

#[derive(Serialize)]
struct AuthenticateResponse {
    token: String,
}

#[derive(Serialize, Deserialize)]
struct TokenClaims {
    sub: String,
    nickname: String,
    exp: usize,
}

#[derive(Deserialize)]
struct GetUserQuery {
    nickname: String,
}

#[tokio::main]
async fn main() {
    let jwt_secret = std::env::var("JWT_SECRET").expect("JWT_SECRET must be set");
    let collection = create_collection().await;
    ensure_nickname_index(&collection).await;

    let state = AppState {
        collection,
        jwt_secret,
    };

    // [TODO] Add GET /health (200 OK) for ALB/Kubernetes health checks; point the ingress
    // healthcheck-path annotation at /health instead of relying on GET /.
    let app = Router::new()
        .route("/users", get(get_user).post(create_user))
        .route("/authentications", post(authenticate))
        .with_state(state);

    let bind_addr = std::env::var("USERS_BIND_ADDR").unwrap_or_else(|_| "0.0.0.0:8088".into());
    let listener = tokio::net::TcpListener::bind(&bind_addr).await.unwrap();

    println!("users service listening on {bind_addr}");

    axum::serve(listener, app).await.unwrap();
}

async fn create_collection() -> Collection<UserDocument> {
    let uri = std::env::var("MONGODB_URI").expect("MONGODB_URI must be set");
    let database_name = std::env::var("MONGODB_DATABASE").expect("MONGODB_DATABASE must be set");

    let client = mongodb::Client::with_uri_str(&uri)
        .await
        .expect("failed to connect to MongoDB");

    client.database(&database_name).collection(USERS_COLLECTION)
}

async fn ensure_nickname_index(collection: &Collection<UserDocument>) {
    let index = IndexModel::builder()
        .keys(doc! { "nickname": 1 })
        .options(
            IndexOptions::builder()
                .unique(true)
                .build(),
        )
        .build();

    if let Err(error) = collection.create_index(index).await {
        eprintln!("failed to ensure unique nickname index: {error}");
    }
}

async fn create_user(
    State(state): State<AppState>,
    Json(body): Json<CreateUserRequest>,
) -> Result<(StatusCode, Json<CreateUserResponse>), StatusCode> {
    if body.nickname.trim().is_empty() || body.password.is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }

    let password_hash = hash_password(&body.password).map_err(|error| {
        eprintln!("failed to hash password: {error}");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    let user = UserDocument {
        id: None,
        nickname: body.nickname.clone(),
        password_hash,
    };

    let insert_result = state.collection.insert_one(&user).await.map_err(|error| {
        if is_duplicate_key_error(&error) {
            return StatusCode::CONFLICT;
        }

        eprintln!("failed to create user nickname={}: {error}", body.nickname);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    let id = insert_result
        .inserted_id
        .as_object_id()
        .expect("inserted user id must be an ObjectId")
        .to_hex();

    Ok((
        StatusCode::CREATED,
        Json(CreateUserResponse {
            id,
            nickname: body.nickname,
        }),
    ))
}

async fn authenticate(
    State(state): State<AppState>,
    Json(body): Json<AuthenticateRequest>,
) -> Result<Json<AuthenticateResponse>, StatusCode> {
    if body.nickname.trim().is_empty() || body.password.is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }

    let user = state
        .collection
        .find_one(doc! { "nickname": &body.nickname })
        .await
        .map_err(|error| {
            eprintln!("failed to load user nickname={}: {error}", body.nickname);
            StatusCode::INTERNAL_SERVER_ERROR
        })?
        .ok_or(StatusCode::UNAUTHORIZED)?;

    if !verify_password(&body.password, &user.password_hash) {
        return Err(StatusCode::UNAUTHORIZED);
    }

    let user_id = user
        .id
        .expect("stored user must have _id")
        .to_hex();

    let token = issue_token(&state.jwt_secret, &user_id, &user.nickname).map_err(|error| {
        eprintln!("failed to issue token for user_id={user_id}: {error}");
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

    Ok(Json(AuthenticateResponse { token }))
}

async fn get_user(
    State(state): State<AppState>,
    Query(query): Query<GetUserQuery>,
) -> Result<Json<CreateUserResponse>, StatusCode> {
    if query.nickname.trim().is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }

    let user = state
        .collection
        .find_one(doc! { "nickname": &query.nickname })
        .await
        .map_err(|error| {
            eprintln!("failed to load user nickname={}: {error}", query.nickname);
            StatusCode::INTERNAL_SERVER_ERROR
        })?
        .ok_or(StatusCode::NOT_FOUND)?;

    let id = user
        .id
        .expect("stored user must have _id")
        .to_hex();

    Ok(Json(CreateUserResponse {
        id,
        nickname: user.nickname,
    }))
}

fn hash_password(password: &str) -> Result<String, argon2::password_hash::Error> {
    let salt = SaltString::generate(&mut OsRng);
    let hash = Argon2::default().hash_password(password.as_bytes(), &salt)?;
    Ok(hash.to_string())
}

fn verify_password(password: &str, password_hash: &str) -> bool {
    let Ok(parsed_hash) = PasswordHash::new(password_hash) else {
        return false;
    };

    Argon2::default()
        .verify_password(password.as_bytes(), &parsed_hash)
        .is_ok()
}

fn issue_token(jwt_secret: &str, user_id: &str, nickname: &str) -> Result<String, jsonwebtoken::errors::Error> {
    let expiration = Utc::now() + Duration::hours(TOKEN_TTL_HOURS);
    let claims = TokenClaims {
        sub: user_id.to_string(),
        nickname: nickname.to_string(),
        exp: expiration.timestamp() as usize,
    };

    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(jwt_secret.as_bytes()),
    )
}

fn is_duplicate_key_error(error: &Error) -> bool {
    matches!(
        error.kind.as_ref(),
        ErrorKind::Write(WriteFailure::WriteError(WriteError { code: 11000, .. }))
    )
}
