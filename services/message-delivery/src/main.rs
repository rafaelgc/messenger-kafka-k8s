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
use rdkafka::{
    config::ClientConfig,
    consumer::{Consumer, StreamConsumer},
    message::Message,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::mpsc;

mod topics;

/// Outbound messages to a connected client are sent through this channel.
/// The WebSocket task owns the socket and forwards channel messages to it.
type ConnectionTx = mpsc::UnboundedSender<String>;

/// Shared, process-wide registry of authenticated users and their connections.
/// `Arc` allows cheap clones across tasks; `DashMap` allows concurrent lookups
/// and updates without holding a global lock across `.await` points.
#[derive(Clone)]
struct AppState {
    connections: Arc<DashMap<String, ConnectionTx>>,
}

#[derive(Debug, Deserialize, Serialize)]
struct MessageSentEvent {
    chat_id: u32,
    text: String,
    sender_id: String,
    recipient_ids: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum ClientMessage {
    Auth { user_id: String },
}

#[tokio::main]
async fn main() {
    let state = AppState {
        connections: Arc::new(DashMap::new()),
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
    let (outbound_tx, mut outbound_rx) = mpsc::unbounded_channel::<String>();

    loop {
        tokio::select! {
            maybe_message = socket.recv() => {
                match maybe_message {
                    Some(Ok(WsMessage::Text(text))) => {
                        if let Err(error) =
                            handle_client_message(&text, &mut user_id, &state, outbound_tx.clone())
                        {
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

    if let Some(user_id) = user_id {
        state.connections.remove(&user_id);
        println!("client disconnected: user_id={user_id}");
    }
}

fn handle_client_message(
    text: &str,
    user_id: &mut Option<String>,
    state: &AppState,
    outbound_tx: ConnectionTx,
) -> Result<(), String> {
    let message: ClientMessage = serde_json::from_str(text)
        .map_err(|error| format!("invalid JSON: {error}"))?;

    match message {
        ClientMessage::Auth { user_id: id } => {
            // TODO: Replace self-reported user_id with verification of an auth token.
            if user_id.is_some() {
                return Err("client is already authenticated".into());
            }

            state.connections.insert(id.clone(), outbound_tx);
            *user_id = Some(id.clone());
            println!("client authenticated as user_id={id}");
        }
    }

    Ok(())
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
        "received message.sent: chat_id={}, sender_id={}, text={}, recipients={}",
        event.chat_id,
        event.sender_id,
        event.text,
        event.recipient_ids.len()
    );

    let outbound = serde_json::to_string(&event)
        .map_err(|error| format!("failed to serialize outbound message: {error}"))?;

    let delivered_to = deliver_to_recipients(state, &event.recipient_ids, &outbound);

    println!(
        "delivered message.sent to {delivered_to} connected recipient(s) (chat_id={}, {} recipient(s) in event)",
        event.chat_id,
        event.recipient_ids.len()
    );

    Ok(())
}

fn deliver_to_recipients(state: &AppState, recipient_ids: &[String], payload: &str) -> usize {
    let mut delivered_to = 0;
    let mut stale_users = Vec::new();

    for recipient_id in recipient_ids {
        if let Some(tx) = state.connections.get(recipient_id) {
            if tx.send(payload.to_string()).is_err() {
                stale_users.push(recipient_id.clone());
            } else {
                delivered_to += 1;
            }
        }
    }

    for user_id in stale_users {
        eprintln!("removing stale connection for user_id={user_id}");
        state.connections.remove(&user_id);
    }

    delivered_to
}
