mod message_sent;

use futures::StreamExt;
use rdkafka::{
    config::ClientConfig,
    consumer::{Consumer, StreamConsumer},
};

use crate::{topics, AppState};

pub(crate) async fn run(state: AppState) -> Result<(), String> {
    let consumer = create_consumer();

    consumer
        .subscribe(&[topics::MESSAGE_SENT])
        .map_err(|error| format!("failed to subscribe to message.sent topic: {error}"))?;

    tracing::info!(
        "message-storage listening on topic '{}' as group '{}'",
        topics::MESSAGE_SENT,
        std::env::var("KAFKA_CONSUMER_GROUP").unwrap_or_else(|_| "message-storage".into())
    );

    let mut message_stream = consumer.stream();

    while let Some(maybe_message) = message_stream.next().await {
        match maybe_message {
            Ok(message) => {
                if let Err(error) = message_sent::handle(&state.collection, &message).await {
                    tracing::error!(error = %error, "failed to handle kafka message");
                }
            }
            Err(error) => {
                tracing::error!(error = %error, "kafka consumer error");
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
