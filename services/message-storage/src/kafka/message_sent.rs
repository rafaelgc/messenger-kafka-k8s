use mongodb::Collection;
use rdkafka::message::Message;
use tracing::{Instrument, Span};

use crate::{topics, StoredMessage};

pub(crate) async fn handle(
    collection: &Collection<StoredMessage>,
    message: &impl Message,
) -> Result<(), String> {
    let partition = message.partition();
    let offset = message.offset();
    let payload = message
        .payload()
        .ok_or_else(|| "message has no payload".to_string())?
        .to_vec();

    // [TODO][TRACING] Extract W3C traceparent from Kafka message headers and set_parent
    // on the consume span so it links to the public-api kafka.publish span.
    async {
        let event: StoredMessage = serde_json::from_slice(&payload)
            .map_err(|error| format!("invalid message.sent payload: {error}"))?;

        Span::current().record("messaging.chat_id", event.chat_id.as_str());

        collection
            .insert_one(&event)
            .await
            .map_err(|error| format!("failed to store message in MongoDB: {error}"))?;

        tracing::debug!(
            chat_id = %event.chat_id,
            sender_id = %event.sender_id,
            "stored message from kafka"
        );

        Ok(())
    }
    .instrument(tracing::info_span!(
        "kafka.consume",
        otel.name = "message.sent process",
        messaging.system = "kafka",
        messaging.destination = topics::MESSAGE_SENT,
        messaging.operation = "process",
        messaging.kafka.partition = partition,
        messaging.kafka.offset = offset,
        messaging.chat_id = tracing::field::Empty,
    ))
    .await
}
