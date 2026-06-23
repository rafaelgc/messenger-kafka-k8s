use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    routing::get,
    Json, Router,
};
use futures::{StreamExt, TryStreamExt};
use mongodb::bson::{doc, oid::ObjectId};
use mongodb::options::FindOptions;
use mongodb::Collection;
use rdkafka::{
    config::ClientConfig,
    consumer::{Consumer, StreamConsumer},
    message::Message,
};
use serde::{Deserialize, Serialize};

mod topics;

const MESSAGES_COLLECTION: &str = "messages";
const DEFAULT_LIMIT: u32 = 20;
const MAX_LIMIT: u32 = 100;

#[derive(Clone)]
struct AppState {
    collection: Collection<StoredMessage>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct StoredMessage {
    #[serde(rename = "_id", skip_serializing_if = "Option::is_none")]
    id: Option<ObjectId>,
    chat_id: u32,
    text: String,
    sender_id: String,
}

#[derive(Serialize)]
struct MessageItem {
    id: String,
    chat_id: u32,
    text: String,
    sender_id: String,
}

#[derive(Serialize)]
struct PaginatedMessagesResponse {
    messages: Vec<MessageItem>,
    pagination: PaginationMeta,
}

#[derive(Serialize)]
struct PaginationMeta {
    has_more: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    next_cursor: Option<String>,
}

#[derive(Deserialize)]
struct ListMessagesQuery {
    limit: Option<u32>,
    before: Option<String>,
}

#[tokio::main]
async fn main() {
    let state = AppState {
        collection: create_collection().await,
    };

    tokio::select! {
        _ = tokio::signal::ctrl_c() => {
            println!("shutdown signal received");
        }
        result = run_http_server(state.clone()) => {
            if let Err(error) = result {
                eprintln!("http server error: {error}");
            }
        }
        result = run_kafka_consumer(state) => {
            if let Err(error) = result {
                eprintln!("kafka consumer error: {error}");
            }
        }
    }
}

async fn run_http_server(state: AppState) -> Result<(), String> {
    let app = Router::new()
        .route("/chats/{chat_id}/messages", get(list_messages))
        .with_state(state);

    let bind_addr =
        std::env::var("STORAGE_BIND_ADDR").unwrap_or_else(|_| "0.0.0.0:8087".into());

    let listener = tokio::net::TcpListener::bind(&bind_addr)
        .await
        .map_err(|error| format!("failed to bind http server: {error}"))?;

    println!("message-storage http server listening on {bind_addr}");

    axum::serve(listener, app)
        .await
        .map_err(|error| format!("http server failed: {error}"))?;

    Ok(())
}

async fn list_messages(
    State(state): State<AppState>,
    Path(chat_id): Path<u32>,
    Query(query): Query<ListMessagesQuery>,
) -> Result<Json<PaginatedMessagesResponse>, StatusCode> {
    let limit = query.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);
    let fetch_limit = (limit + 1) as i64;

    let mut filter = doc! { "chat_id": chat_id };

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

    let cursor = state
        .collection
        .find(filter)
        .with_options(options)
        .await
        .map_err(|error| {
            eprintln!("failed to query messages for chat_id={chat_id}: {error}");
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    let mut messages = cursor
        .try_collect::<Vec<StoredMessage>>()
        .await
        .map_err(|error| {
            eprintln!("failed to read messages for chat_id={chat_id}: {error}");
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

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

async fn create_collection() -> Collection<StoredMessage> {
    let uri = std::env::var("MONGODB_URI").expect("MONGODB_URI must be set");
    let database_name = std::env::var("MONGODB_DATABASE").expect("MONGODB_DATABASE must be set");

    let client = mongodb::Client::with_uri_str(&uri)
        .await
        .expect("failed to connect to MongoDB");

    client
        .database(&database_name)
        .collection(MESSAGES_COLLECTION)
}

async fn run_kafka_consumer(state: AppState) -> Result<(), String> {
    let consumer = create_consumer();

    consumer
        .subscribe(&[topics::MESSAGE_SENT])
        .map_err(|error| format!("failed to subscribe to message.sent topic: {error}"))?;

    println!(
        "message-storage listening on topic '{}' as group '{}'",
        topics::MESSAGE_SENT,
        std::env::var("KAFKA_CONSUMER_GROUP").unwrap_or_else(|_| "message-storage".into())
    );

    let mut message_stream = consumer.stream();

    while let Some(maybe_message) = message_stream.next().await {
        match maybe_message {
            Ok(message) => {
                if let Err(error) = handle_kafka_message(&state.collection, &message).await {
                    eprintln!("failed to handle message: {error}");
                }
            }
            Err(error) => {
                eprintln!("kafka consumer error: {error}");
            }
        }
    }

    Ok(())
}

fn create_consumer() -> StreamConsumer {
    let brokers = std::env::var("KAFKA_BROKERS").expect("KAFKA_BROKERS must be set");
    let group_id =
        std::env::var("KAFKA_CONSUMER_GROUP").unwrap_or_else(|_| "message-storage".into());

    ClientConfig::new()
        .set("bootstrap.servers", &brokers)
        .set("group.id", &group_id)
        .set("auto.offset.reset", "latest")
        .set("enable.auto.commit", "true")
        .create()
        .expect("failed to create Kafka consumer")
}

async fn handle_kafka_message(
    collection: &Collection<StoredMessage>,
    message: &impl Message,
) -> Result<(), String> {
    let payload = message
        .payload()
        .ok_or_else(|| "message has no payload".to_string())?;

    let event: StoredMessage = serde_json::from_slice(payload)
        .map_err(|error| format!("invalid message.sent payload: {error}"))?;

    collection
        .insert_one(&event)
        .await
        .map_err(|error| format!("failed to store message in MongoDB: {error}"))?;

    println!(
        "stored message: chat_id={}, sender_id={}, text={}",
        event.chat_id, event.sender_id, event.text
    );

    Ok(())
}
