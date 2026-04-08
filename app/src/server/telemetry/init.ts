/**
 * OpenTelemetry SDK bootstrap for the Brain server.
 *
 * Pure function that reads env and returns a TelemetryHandle with
 * TracerProvider, MeterProvider, LoggerProvider, and a shutdown function.
 *
 * Exporter selection:
 * - Console exporters when OTEL_EXPORTER_OTLP_ENDPOINT is unset (dev)
 * - OTLP HTTP exporters when OTEL_EXPORTER_OTLP_ENDPOINT is set (prod)
 *
 * Graceful degradation: if initialization fails, returns a no-op handle
 * so the server can still start.
 */

import * as otelApi from "@opentelemetry/api";
import type { TracerProvider as ApiTracerProvider, MeterProvider as ApiMeterProvider } from "@opentelemetry/api";
import * as otelLogs from "@opentelemetry/api-logs";
import type { LoggerProvider as ApiLoggerProvider } from "@opentelemetry/api-logs";

// Destructure after namespace import for Bun CJS/ESM interop resilience
const { trace, metrics, context } = otelApi;
const { logs } = otelLogs;
import { resourceFromAttributes } from "@opentelemetry/resources";
import type { Resource } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";
import { BasicTracerProvider, BatchSpanProcessor, ConsoleSpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { MeterProvider, PeriodicExportingMetricReader, ConsoleMetricExporter } from "@opentelemetry/sdk-metrics";
import { LoggerProvider, SimpleLogRecordProcessor, ConsoleLogRecordExporter } from "@opentelemetry/sdk-logs";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";

export type ExporterType = "console" | "otlp" | "noop";

export interface TelemetryHandle {
  readonly tracerProvider: ApiTracerProvider;
  readonly meterProvider: ApiMeterProvider;
  readonly loggerProvider: ApiLoggerProvider;
  readonly exporterType: ExporterType;
  readonly shutdown: () => Promise<void>;
}

function buildResource(): Resource {
  const serviceVersion = process.env.SERVICE_VERSION ?? "unknown";
  return resourceFromAttributes({
    [ATTR_SERVICE_NAME]: "osabio-server",
    [ATTR_SERVICE_VERSION]: serviceVersion,
  });
}

function createConsoleProviders(resource: Resource): {
  tracerProvider: BasicTracerProvider;
  meterProvider: MeterProvider;
  loggerProvider: LoggerProvider;
} {
  const tracerProvider = new BasicTracerProvider({
    resource,
    spanProcessors: [new SimpleSpanProcessor(new ConsoleSpanExporter())],
  });

  const meterProvider = new MeterProvider({
    resource,
    readers: [new PeriodicExportingMetricReader({ exporter: new ConsoleMetricExporter() })],
  });

  const loggerProvider = new LoggerProvider({
    resource,
    processors: [new SimpleLogRecordProcessor(new ConsoleLogRecordExporter())],
  });

  return { tracerProvider, meterProvider, loggerProvider };
}

function createOtlpProviders(resource: Resource, endpoint: string): {
  tracerProvider: BasicTracerProvider;
  meterProvider: MeterProvider;
  loggerProvider: LoggerProvider;
} {
  // Bun supports synchronous require() for these packages
  const { OTLPTraceExporter } = require("@opentelemetry/exporter-trace-otlp-http");
  const { OTLPMetricExporter } = require("@opentelemetry/exporter-metrics-otlp-http");
  const { OTLPLogExporter } = require("@opentelemetry/exporter-logs-otlp-http");

  const tracerProvider = new BasicTracerProvider({
    resource,
    spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }))],
  });

  const meterProvider = new MeterProvider({
    resource,
    readers: [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({ url: `${endpoint}/v1/metrics` }),
      }),
    ],
  });

  const loggerProvider = new LoggerProvider({
    resource,
    processors: [new SimpleLogRecordProcessor(new OTLPLogExporter({ url: `${endpoint}/v1/logs` }))],
  });

  return { tracerProvider, meterProvider, loggerProvider };
}

function buildShutdown(
  tracerProvider: BasicTracerProvider,
  meterProvider: MeterProvider,
  loggerProvider: LoggerProvider,
): () => Promise<void> {
  let alreadyShutDown = false;

  return async () => {
    if (alreadyShutDown) return;
    alreadyShutDown = true;

    await Promise.allSettled([
      tracerProvider.forceFlush().then(() => tracerProvider.shutdown()),
      meterProvider.forceFlush().then(() => meterProvider.shutdown()),
      loggerProvider.forceFlush().then(() => loggerProvider.shutdown()),
    ]);
  };
}

function registerProviders(
  tracerProvider: BasicTracerProvider,
  meterProvider: MeterProvider,
  loggerProvider: LoggerProvider,
): void {
  const contextManager = new AsyncLocalStorageContextManager();
  contextManager.enable();
  context.setGlobalContextManager(contextManager);

  trace.setGlobalTracerProvider(tracerProvider);
  metrics.setGlobalMeterProvider(meterProvider);
  logs.setGlobalLoggerProvider(loggerProvider);
}

export function createNoopTelemetryHandle(): TelemetryHandle {
  return {
    tracerProvider: trace.getTracerProvider(),
    meterProvider: metrics.getMeterProvider(),
    loggerProvider: logs.getLoggerProvider(),
    exporterType: "noop",
    shutdown: async () => {},
  };
}

/**
 * Initialize OpenTelemetry SDK.
 *
 * Reads OTEL_EXPORTER_OTLP_ENDPOINT from env to select exporter type.
 * Returns a TelemetryHandle with providers and a shutdown function.
 * Falls back to no-op handle on failure so the server can still start.
 */
export function initTelemetry(): TelemetryHandle {
  try {
    const resource = buildResource();
    const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

    const { tracerProvider, meterProvider, loggerProvider } = endpoint
      ? createOtlpProviders(resource, endpoint)
      : createConsoleProviders(resource);

    registerProviders(tracerProvider, meterProvider, loggerProvider);

    return {
      tracerProvider,
      meterProvider,
      loggerProvider,
      exporterType: endpoint ? "otlp" : "console",
      shutdown: buildShutdown(tracerProvider, meterProvider, loggerProvider),
    };
  } catch (error) {
    console.error("[telemetry] Failed to initialize OpenTelemetry SDK, falling back to no-op:", error);
    return createNoopTelemetryHandle();
  }
}
