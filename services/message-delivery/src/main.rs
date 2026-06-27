use axum::{
    extract::{
        ws::{Message as WsMessage, WebSocket, WebSocketUpgrade},
        State,
    },
    response::Response,
    routing::get,
    Router,
};
use dashmap::DashMap;
use futures::StreamExt;
use jsonwebtoken::{decode, DecodingKey, Validation};
use rdkafka::{
    config::ClientConfig,
    consumer::{Consumer, StreamConsumer},
    message::Message,
};
use serde::{Deserialize, Serialize};
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc,
};
use tokio::sync::mpsc;

mod topics;

/// Outbound messages to a connected client are sent through this channel.
/// The WebSocket task owns the socket and forwards channel messages to it.
type ConnectionTx = mpsc::UnboundedSender<String>;

type ConnectionId = u64;

static NEXT_CONNECTION_ID: AtomicU64 = AtomicU64::new(1);

/// Shared, process-wide registry of authenticated users and their connections.
/// A user may have multiple simultaneous connections (e.g. phone + laptop).
/// `Arc` allows cheap clones across tasks; `DashMap` allows concurrent lookups
/// and updates without holding a global lock across `.await` points.
#[derive(Clone)]
struct AppState {
    connections: Arc<DashMap<String, Vec<(ConnectionId, ConnectionTx)>>>,
    jwt_secret: String,
    pod_name: String,
}

#[derive(Debug, Deserialize, Serialize)]
struct MessageSentEvent {
    chat_id: String,
    text: String,
    sender_id: String,
    recipient_ids: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum ClientMessage {
    Auth { token: String },
}

#[derive(Deserialize)]
#[allow(dead_code)]
struct TokenClaims {
    sub: String,
    nickname: String,
    exp: usize,
}

#[tokio::main]
async fn main() {
    let jwt_secret = std::env::var("JWT_SECRET")
        .unwrap_or_else(|_| "dev-jwt-secret-change-in-production".into());
    let pod_name = std::env::var("POD_NAME").unwrap_or_else(|_| "unknown".into());

    let state = AppState {
        connections: Arc::new(DashMap::new()),
        jwt_secret,
        pod_name,
    };

    tokio::select! {
        _ = tokio::signal::ctrl_c() => {
            println!("shutdown signal received");
        }
        result = run_websocket_server(state.clone()) => {
            if let Err(error) = result {
                eprintln!("websocket server error: {error}");
            }
        }
        result = run_kafka_consumer(state) => {
            if let Err(error) = result {
                eprintln!("kafka consumer error: {error}");
            }
        }
    }
}

async fn run_websocket_server(state: AppState) -> Result<(), String> {
    let bind_addr =
        std::env::var("DELIVERY_BIND_ADDR").unwrap_or_else(|_| "0.0.0.0:8081".into());

    let app = Router::new()
        .route("/ws", get(ws_handler))
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(&bind_addr)
        .await
        .map_err(|error| format!("failed to bind websocket server: {error}"))?;

    println!("websocket server listening on {bind_addr}");

    axum::serve(listener, app)
        .await
        .map_err(|error| format!("websocket server failed: {error}"))?;

    Ok(())
}

async fn ws_handler(State(state): State<AppState>, ws: WebSocketUpgrade) -> Response {
    ws.on_upgrade(move |socket| handle_socket(socket, state))
}

async fn handle_socket(mut socket: WebSocket, state: AppState) {
    let mut user_id: Option<String> = None;
    let mut connection_id: Option<ConnectionId> = None;
    let (outbound_tx, mut outbound_rx) = mpsc::unbounded_channel::<String>();

    loop {
        tokio::select! {
            maybe_message = socket.recv() => {
                match maybe_message {
                    Some(Ok(WsMessage::Text(text))) => {
                        if let Err(error) = handle_client_message(
                            &text,
                            &mut user_id,
                            &mut connection_id,
                            &state,
                            outbound_tx.clone(),
                        ) {
                            eprintln!("invalid client message: {error}");
                        }
                    }
                    Some(Ok(WsMessage::Close(_))) | None => break,
                    Some(Ok(_)) => {}
                    Some(Err(error)) => {
                        eprintln!("websocket receive error: {error}");
                        break;
                    }
                }
            }
            outgoing = outbound_rx.recv() => {
                match outgoing {
                    Some(text) => {
                        if socket.send(WsMessage::Text(text.into())).await.is_err() {
                            break;
                        }
                    }
                    None => break,
                }
            }
        }
    }

    if let (Some(user_id), Some(connection_id)) = (user_id, connection_id) {
        unregister_connection(&state, &user_id, connection_id);
        println!("client disconnected: user_id={user_id}, connection_id={connection_id}");
    }
}

fn register_connection(
    state: &AppState,
    user_id: &str,
    connection_id: ConnectionId,
    outbound_tx: ConnectionTx,
) {
    state
        .connections
        .entry(user_id.to_string())
        .or_default()
        .push((connection_id, outbound_tx));
}

fn unregister_connection(state: &AppState, user_id: &str, connection_id: ConnectionId) {
    let should_remove_user = {
        let mut connections = match state.connections.get_mut(user_id) {
            Some(connections) => connections,
            None => return,
        };
        connections.retain(|(id, _)| *id != connection_id);
        connections.is_empty()
    };

    if should_remove_user {
        state.connections.remove(user_id);
    }
}

fn handle_client_message(
    text: &str,
    user_id: &mut Option<String>,
    connection_id: &mut Option<ConnectionId>,
    state: &AppState,
    outbound_tx: ConnectionTx,
) -> Result<(), String> {
    let message: ClientMessage = serde_json::from_str(text)
        .map_err(|error| format!("invalid JSON: {error}"))?;

    match message {
        ClientMessage::Auth { token } => {
            if user_id.is_some() {
                return Err("client is already authenticated".into());
            }

            let authenticated_user_id = decode_token(&state.jwt_secret, &token)?;

            let conn_id = NEXT_CONNECTION_ID.fetch_add(1, Ordering::Relaxed);
            register_connection(state, &authenticated_user_id, conn_id, outbound_tx);
            *user_id = Some(authenticated_user_id.clone());
            *connection_id = Some(conn_id);
            println!(
                "pod={} client authenticated as user_id={authenticated_user_id}, connection_id={conn_id}",
                state.pod_name
            );
        }
    }

    Ok(())
}

fn decode_token(jwt_secret: &str, token: &str) -> Result<String, String> {
    decode::<TokenClaims>(
        token,
        &DecodingKey::from_secret(jwt_secret.as_bytes()),
        &Validation::default(),
    )
    .map(|data| data.claims.sub)
    .map_err(|error| format!("invalid auth token: {error}"))
}

async fn run_kafka_consumer(state: AppState) -> Result<(), String> {
    let consumer = create_consumer();

    consumer
        .subscribe(&[topics::MESSAGE_SENT])
        .map_err(|error| format!("failed to subscribe to message.sent topic: {error}"))?;

    println!(
        "message-delivery listening on topic '{}' as group '{}'",
        topics::MESSAGE_SENT,
        std::env::var("KAFKA_CONSUMER_GROUP").unwrap_or_else(|_| "message-delivery".into())
    );

    let mut message_stream = consumer.stream();

    while let Some(maybe_message) = message_stream.next().await {
        match maybe_message {
            Ok(message) => {
                if let Err(error) = handle_kafka_message(&message, &state) {
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
        std::env::var("KAFKA_CONSUMER_GROUP").unwrap_or_else(|_| "message-delivery".into());

    ClientConfig::new()
        .set("bootstrap.servers", &brokers)
        .set("group.id", &group_id)
        .set("auto.offset.reset", "latest")
        .set("enable.auto.commit", "true")
        .create()
        .expect("failed to create Kafka consumer")
}

fn handle_kafka_message(message: &impl Message, state: &AppState) -> Result<(), String> {
    let payload = message
        .payload()
        .ok_or_else(|| "message has no payload".to_string())?;

    let event: MessageSentEvent = serde_json::from_slice(payload)
        .map_err(|error| format!("invalid message.sent payload: {error}"))?;

    println!(
        "pod={} received message.sent: chat_id={}, sender_id={}, text={}, recipients={}",
        state.pod_name,
        event.chat_id,
        event.sender_id,
        event.text,
        event.recipient_ids.len()
    );

    let outbound = serde_json::to_string(&event)
        .map_err(|error| format!("failed to serialize outbound message: {error}"))?;

    let delivered_to = deliver_to_recipients(state, &event.recipient_ids, &outbound);

    println!(
        "pod={} delivered message.sent to {delivered_to} connected recipient(s) (chat_id={}, {} recipient(s) in event)",
        state.pod_name,
        event.chat_id,
        event.recipient_ids.len()
    );

    Ok(())
}

fn deliver_to_recipients(state: &AppState, recipient_ids: &[String], payload: &str) -> usize {
    let mut delivered_to = 0;
    let mut stale_connections = Vec::new();

    for recipient_id in recipient_ids {
        if let Some(connections) = state.connections.get(recipient_id) {
            for (connection_id, tx) in connections.iter() {
                if tx.send(payload.to_string()).is_err() {
                    stale_connections.push((recipient_id.clone(), *connection_id));
                } else {
                    delivered_to += 1;
                }
            }
        }
    }

    for (user_id, connection_id) in stale_connections {
        eprintln!("removing stale connection {connection_id} for user_id={user_id}");
        unregister_connection(state, &user_id, connection_id);
    }

    delivered_to
}
