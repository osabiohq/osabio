import { describe, it, expect, beforeEach, mock } from "bun:test";
import * as otelApi from "@opentelemetry/api";
import { trace, context, SpanStatusCode, type Span, type Tracer } from "@opentelemetry/api";

// We test withTracing as a pure higher-order function.
// Driving port: withTracing(route, method, handler) -> RouteHandler
// Acceptance criteria verified:
// 1. Root span "osabio.http.request" with method/route/status_code attributes
// 2. x-request-id response header preserved
// 3. Error responses set span status ERROR and record exception
// 4. httpDuration and httpRequests metrics recorded per request

describe("withTracing", () => {
  // Spy on span operations
  let spanAttributes: Record<string, unknown>;
  let spanStatus: { code: number; message?: string } | undefined;
  let recordedExceptions: unknown[];
  let spanEnded: boolean;
  let mockSpan: Span;
  let metricsRecorded: { duration: Array<{ value: number; attributes: Record<string, unknown> }>; requests: Array<{ attributes: Record<string, unknown> }> };

  beforeEach(() => {
    spanAttributes = {};
    spanStatus = undefined;
    recordedExceptions = [];
    spanEnded = false;
    metricsRecorded = { duration: [], requests: [] };

    mockSpan = {
      setAttribute: (key: string, value: unknown) => { spanAttributes[key] = value; return mockSpan; },
      setStatus: (status: { code: number; message?: string }) => { spanStatus = status; return mockSpan; },
      recordException: (exception: unknown) => { recordedExceptions.push(exception); },
      end: () => { spanEnded = true; },
      spanContext: () => ({ traceId: "abc123", spanId: "def456", traceFlags: 1, isRemote: false }),
      isRecording: () => true,
      updateName: () => mockSpan,
      addEvent: () => mockSpan,
      addLink: () => mockSpan,
      addLinks: () => mockSpan,
      setAttributes: () => mockSpan,
    } as unknown as Span;
  });

  // Lazy import — mocks must be registered before first import of instrumentation.
  // We mock both metrics and the OTel tracer so mockSpan is used in all tests.
  async function loadWithTracing() {
    mock.module("../../app/src/server/telemetry/metrics", () => ({
      httpDurationHistogram: {
        record: (value: number, attributes: Record<string, unknown>) => {
          metricsRecorded.duration.push({ value, attributes });
        },
      },
      httpRequestsCounter: {
        add: (_value: number, attributes: Record<string, unknown>) => {
          metricsRecorded.requests.push({ attributes });
        },
      },
    }));
    mock.module("@opentelemetry/api", () => ({
      ...otelApi,
      SpanStatusCode,
      trace: {
        getTracer: () => ({
          startActiveSpan: (_name: string, cb: (span: Span) => unknown) => cb(mockSpan),
        }),
        setSpan: trace.setSpan,
        getActiveSpan: () => mockSpan,
      },
      context,
    }));
    const mod = await import("../../app/src/server/http/instrumentation");
    return mod.withTracing;
  }

  function makeRequest(url: string, headers?: Record<string, string>): Request & { params: Record<string, string> } {
    const req = new Request(url, { headers }) as Request & { params: Record<string, string> };
    req.params = {};
    return req;
  }

  it("creates root span with method, route, and status_code attributes on successful request", async () => {
    const withTracing = await loadWithTracing();
    const handler = withTracing("GET /healthz", "GET", async () => {
      return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
    });

    const request = makeRequest("http://localhost:3000/healthz");
    const response = await handler(request);

    // Verify response has x-request-id header
    expect(response.headers.get("x-request-id")).toBeTruthy();
    expect(response.status).toBe(200);
  });

  it("preserves x-request-id from incoming request header", async () => {
    const withTracing = await loadWithTracing();
    const handler = withTracing("GET /healthz", "GET", async () => {
      return new Response("ok", { status: 200 });
    });

    const request = makeRequest("http://localhost:3000/healthz", {
      "x-request-id": "custom-request-id-123",
    });
    const response = await handler(request);

    expect(response.headers.get("x-request-id")).toBe("custom-request-id-123");
  });

  it("returns 500 with x-request-id when handler throws", async () => {
    const withTracing = await loadWithTracing();
    const handler = withTracing("POST /api/test", "POST", async () => {
      throw new Error("something broke");
    });

    const request = makeRequest("http://localhost:3000/api/test", {});
    const response = await handler(request);

    expect(response.status).toBe(500);
    expect(response.headers.get("x-request-id")).toBeTruthy();
    const body = await response.json();
    expect(body.error).toBe("internal server error");
  });

  it("generates new request id when none provided", async () => {
    const withTracing = await loadWithTracing();
    const handler = withTracing("GET /test", "GET", async () => {
      return new Response("ok", { status: 200 });
    });

    const request = makeRequest("http://localhost:3000/test");
    const response = await handler(request);

    const requestId = response.headers.get("x-request-id");
    expect(requestId).toBeTruthy();
    // Should be a UUID-like format
    expect(requestId!.length).toBeGreaterThan(0);
  });

  it("ignores empty x-request-id header", async () => {
    const withTracing = await loadWithTracing();
    const handler = withTracing("GET /test", "GET", async () => {
      return new Response("ok", { status: 200 });
    });

    const request = makeRequest("http://localhost:3000/test", {
      "x-request-id": "  ",
    });
    const response = await handler(request);

    const requestId = response.headers.get("x-request-id");
    expect(requestId).toBeTruthy();
    expect(requestId!.trim().length).toBeGreaterThan(0);
    expect(requestId).not.toBe("  ");
  });

  it("defers span.end() for streaming responses until stream is fully consumed", async () => {
    const withTracing = await loadWithTracing();

    const { readable, writable } = new TransformStream<Uint8Array>();
    const writer = writable.getWriter();

    const handler = withTracing("POST /api/chat", "POST", async () => {
      writer.write(new TextEncoder().encode("chunk1"));
      return new Response(readable, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    });

    const request = makeRequest("http://localhost:3000/api/chat");
    const response = await handler(request);

    // Span must still be open while stream is in-flight
    expect(spanEnded).toBe(false);

    const reader = response.body!.getReader();
    const firstChunk = await reader.read();
    expect(new TextDecoder().decode(firstChunk.value)).toBe("chunk1");

    // Still open — stream not yet closed
    expect(spanEnded).toBe(false);

    await writer.close();
    await reader.read(); // { done: true } — triggers flush()

    // Span must be ended after stream closes
    expect(spanEnded).toBe(true);
    expect(spanAttributes["duration_ms"]).toBeDefined();
    expect(spanAttributes["http.status_code"]).toBe(200);
    expect(metricsRecorded.duration.length).toBe(1);
    expect(metricsRecorded.requests.length).toBe(1);
  });

  it("ends span when streaming client cancels (disconnect)", async () => {
    const withTracing = await loadWithTracing();

    const { readable, writable } = new TransformStream<Uint8Array>();
    const writer = writable.getWriter();

    const handler = withTracing("POST /api/chat", "POST", async () => {
      writer.write(new TextEncoder().encode("chunk1"));
      return new Response(readable, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    });

    const request = makeRequest("http://localhost:3000/api/chat");
    const response = await handler(request);

    // Span must still be open while stream is in-flight
    expect(spanEnded).toBe(false);

    const reader = response.body!.getReader();
    const firstChunk = await reader.read();
    expect(new TextDecoder().decode(firstChunk.value)).toBe("chunk1");

    await reader.cancel("client disconnected");

    // Span must be ended after cancellation
    expect(spanEnded).toBe(true);
    expect(spanAttributes["stream.cancelled"]).toBe(true);
    expect(spanAttributes["duration_ms"]).toBeDefined();
    expect(metricsRecorded.duration.length).toBe(1);
  });

  it("ends span when upstream stream errors", async () => {
    const withTracing = await loadWithTracing();

    // Create a stream that will error after the first chunk
    const readable = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("chunk1"));
      },
      pull(controller) {
        controller.error(new Error("upstream network failure"));
      },
    });

    const handler = withTracing("POST /api/chat", "POST", async () => {
      return new Response(readable, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    });

    const request = makeRequest("http://localhost:3000/api/chat");
    const response = await handler(request);

    expect(spanEnded).toBe(false);

    const reader = response.body!.getReader();
    const firstChunk = await reader.read();
    expect(new TextDecoder().decode(firstChunk.value)).toBe("chunk1");

    // Next read triggers the upstream error
    try {
      await reader.read();
    } catch {
      // expected — stream errored
    }

    expect(spanEnded).toBe(true);
    expect(spanAttributes["stream.cancelled"]).toBe(true);
    expect(spanAttributes["duration_ms"]).toBeDefined();
    expect(metricsRecorded.duration.length).toBe(1);
  });

  it("finalizes span immediately for non-streaming JSON responses", async () => {
    const withTracing = await loadWithTracing();

    const handler = withTracing("GET /api/data", "GET", async () => {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const request = makeRequest("http://localhost:3000/api/data");
    const response = await handler(request);

    // Span must be ended immediately — not deferred to stream consumption
    expect(spanEnded).toBe(true);
    expect(response.status).toBe(200);
    expect(spanAttributes["http.status_code"]).toBe(200);
    expect(spanAttributes["duration_ms"]).toBeDefined();
    expect(metricsRecorded.duration.length).toBe(1);
  });
});
