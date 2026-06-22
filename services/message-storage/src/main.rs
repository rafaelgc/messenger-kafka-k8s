use futures::StreamExt;
use mongodb::Collection;
use rdkafka::{
    config::ClientConfig,
    consumer::{Consumer, StreamConsumer},
    message::Message,
};
use serde::{Deserialize, Serialize};

mod topics;

const MESSAGES_COLLECTION: &str = "messages";

#[derive(Debug, Deserialize, Serialize)]
struct MessageSentEvent {
    chat_id: u32,
    text: String,
    sender_id: String,
}

#[tokio::main]
async fn main() {
    let collection = create_collection().await;
    let consumer = create_consumer();

    consumer
        .subscribe(&[topics::MESSAGE_SENT])
        .expect("failed to subscribe to message.sent topic");

    println!(
        "message-storage listening on topic '{}' as group '{}'",
        topics::MESSAGE_SENT,
        std::env::var("KAFKA_CONSUMER_GROUP").unwrap_or_else(|_| "message-storage".into())
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
                        if let Err(error) = handle_message(&collection, &message).await {
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

async fn create_collection() -> Collection<MessageSentEvent> {
    let uri = std::env::var("MONGODB_URI").expect("MONGODB_URI must be set");
    let database_name = std::env::var("MONGODB_DATABASE").expect("MONGODB_DATABASE must be set");

    let client = mongodb::Client::with_uri_str(&uri)
        .await
        .expect("failed to connect to MongoDB");

    client
        .database(&database_name)
        .collection(MESSAGES_COLLECTION)
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

async fn handle_message(
    collection: &Collection<MessageSentEvent>,
    message: &impl Message,
) -> Result<(), String> {
    let payload = message
        .payload()
        .ok_or_else(|| "message has no payload".to_string())?;

    let event: MessageSentEvent = serde_json::from_slice(payload)
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
