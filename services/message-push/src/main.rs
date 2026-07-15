#[tokio::main]
async fn main() {
    // [TODO] Add GET /health (200 OK) for ALB/Kubernetes health checks when this service
    // exposes HTTP; point the ingress healthcheck-path annotation at /health.
    println!("Hello from message-push");

    tokio::signal::ctrl_c()
        .await
        .expect("failed to listen for shutdown signal");
}