use futures::StreamExt;
use rdkafka::{
    config::ClientConfig,
    consumer::{Consumer, StreamConsumer},
    message::Message,
};
use serde::Deserialize;

mod topics;

#[derive(Debug, Deserialize)]
struct MessageSentEvent {
    chat_id: u32,
    text: String,
    sender_id: String,
}

#[tokio::main]
async fn main() {
    // WebSocket server will be started here (DELIVERY_BIND_ADDR).

    let consumer = create_consumer();

    consumer
        .subscribe(&[topics::MESSAGE_SENT])
        .expect("failed to subscribe to message.sent topic");

    println!(
        "message-delivery listening on topic '{}' as group '{}'",
        topics::MESSAGE_SENT,
        std::env::var("KAFKA_CONSUMER_GROUP").unwrap_or_else(|_| "message-delivery".into())
    );

    let mut message_stream = consumer.stream();

    loop {
        tokio::select! {
            _ = tokio::signal::ctrl_c() => {
                println!("shutdown signal received");
                break;
            }
            maybe_message = message_stream.next() => {
                match maybe_message {
                    None => break,
                    Some(Ok(message)) => {
                        if let Err(error) = handle_message(&message) {
                            eprintln!("failed to handle message: {error}");
                        }
                    }
                    Some(Err(error)) => {
                        eprintln!("kafka consumer error: {error}");
                    }
                }
            }
        }
    }
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

fn handle_message(message: &impl Message) -> Result<(), String> {
    let payload = message
        .payload()
        .ok_or_else(|| "message has no payload".to_string())?;

    let event: MessageSentEvent = serde_json::from_slice(payload)
        .map_err(|error| format!("invalid message.sent payload: {error}"))?;

    println!(
        "received message.sent: chat_id={}, sender_id={}, text={}",
        event.chat_id, event.sender_id, event.text
    );

    Ok(())
}
