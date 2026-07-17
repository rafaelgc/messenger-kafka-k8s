use std::time::Duration;

use axum::http::{HeaderMap, Request, Response};
use opentelemetry::global;
use opentelemetry::propagation::Extractor;
use opentelemetry::trace::TracerProvider;
use opentelemetry_sdk::{
    propagation::TraceContextPropagator,
    trace::{Sampler, SdkTracerProvider},
};
use tower_http::{
    classify::SharedClassifier,
    trace::{
        DefaultOnBodyChunk, DefaultOnEos, DefaultOnFailure, DefaultOnRequest, TraceLayer,
    },
};
use tracing::Span;
use tracing_opentelemetry::OpenTelemetrySpanExt;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

pub struct TelemetryGuard {
    provider: SdkTracerProvider,
}

impl TelemetryGuard {
    pub fn init() -> Self {
        global::set_text_map_propagator(TraceContextPropagator::new());

        let service_name = std::env::var("OTEL_SERVICE_NAME").unwrap_or_else(|_| "chat".into());

        let exporter = opentelemetry_otlp::SpanExporter::builder()
            .with_tonic()
            .build()
            .expect("failed to build OTLP span exporter");

        let sampler_ratio = std::env::var("OTEL_TRACES_SAMPLER_ARG")
            .ok()
            .and_then(|value| value.parse::<f64>().ok())
            .unwrap_or(1.0);

        let provider = SdkTracerProvider::builder()
            .with_batch_exporter(exporter)
            .with_sampler(Sampler::ParentBased(Box::new(Sampler::TraceIdRatioBased(
                sampler_ratio,
            ))))
            .with_resource(
                opentelemetry_sdk::Resource::builder_empty()
                    .with_attribute(opentelemetry::KeyValue::new(
                        "service.name",
                        service_name.clone(),
                    ))
                    .build(),
            )
            .build();

        let tracer = provider.tracer(service_name);

        tracing_subscriber::registry()
            .with(
                EnvFilter::try_from_default_env()
                    .unwrap_or_else(|_| EnvFilter::new("info")),
            )
            .with(tracing_opentelemetry::layer().with_tracer(tracer))
            .init();

        Self { provider }
    }

    pub fn shutdown(self) {
        if let Err(error) = self.provider.shutdown() {
            eprintln!("failed to shutdown tracer provider: {error}");
        }
    }
}

struct HeaderExtractor<'a>(&'a HeaderMap);

impl Extractor for HeaderExtractor<'_> {
    fn get(&self, key: &str) -> Option<&str> {
        self.0.get(key).and_then(|value| value.to_str().ok())
    }

    fn keys(&self) -> Vec<&str> {
        self.0.keys().map(|name| name.as_str()).collect()
    }
}

#[derive(Clone, Copy, Default)]
pub struct HttpMakeSpan;

impl<B> tower_http::trace::MakeSpan<B> for HttpMakeSpan {
    fn make_span(&mut self, request: &Request<B>) -> Span {
        let method = request.method().as_str();
        // path + query (OTel http.target); path-only hid ?nickname=… in Tempo.
        let target = request
            .uri()
            .path_and_query()
            .map(|pq| pq.as_str())
            .unwrap_or_else(|| request.uri().path());

        let parent_cx = global::get_text_map_propagator(|propagator| {
            propagator.extract(&HeaderExtractor(request.headers()))
        });

        let span = tracing::info_span!(
            "request",
            otel.name = %format_args!("{method} {target}"),
            method = %method,
            http.target = %target,
            http.status_code = tracing::field::Empty,
        );
        span.set_parent(parent_cx);
        span
    }
}

#[derive(Clone, Copy, Default)]
pub struct HttpRecordStatus;

impl<B> tower_http::trace::OnResponse<B> for HttpRecordStatus {
    fn on_response(self, response: &Response<B>, _latency: Duration, span: &Span) {
        span.record("http.status_code", response.status().as_u16());
    }
}

pub type HttpTraceLayer = TraceLayer<
    SharedClassifier<tower_http::classify::ServerErrorsAsFailures>,
    HttpMakeSpan,
    DefaultOnRequest,
    HttpRecordStatus,
    DefaultOnBodyChunk,
    DefaultOnEos,
    DefaultOnFailure,
>;

pub fn http_trace_layer() -> HttpTraceLayer {
    TraceLayer::new_for_http()
        .make_span_with(HttpMakeSpan)
        .on_response(HttpRecordStatus)
}
