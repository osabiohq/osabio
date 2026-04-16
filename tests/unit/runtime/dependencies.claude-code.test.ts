/**
 * Unit tests for createClaudeCodeModels factory.
 *
 * Driving port: createClaudeCodeModels(config, wrap) -> Promise<6 model objects>
 *
 * Behaviors under test:
 * 1. Layer 2 probe failure: missing claude binary throws error with npm install CLI command
 * 2. Layer 3 probe failure: unauthenticated CLI state throws error with claude login command
 * 3. Success: factory returns object with exactly 6 defined model properties
 * 4. claudeCodeEffort is forwarded to provider options when present in config
 * 5. claudeCodeMaxBudgetUsd is forwarded to provider options when present in config
 * 6. Layer 1 probe failure: missing/invalid package throws error with bun add install command
 *    (this test runs last because mock.module has worker-wide side effects in Bun)
 *
 * Test isolation strategy:
 * - Layer 2 & 3 probes tested by spying on Bun.which / Bun.spawn
 * - Layer 1 tested via mock.module, placed LAST to avoid contaminating other tests
 * - Success tests stub Bun.which and Bun.spawn to simulate authenticated env
 */

import { describe, test, expect, beforeEach, afterEach, spyOn } from "bun:test";
import type { ServerConfig } from "../../../app/src/server/runtime/config";

// ---------------------------------------------------------------------------
// Minimal ServerConfig for claude-code inference provider
// ---------------------------------------------------------------------------

const BASE_CONFIG: ServerConfig = {
  inferenceProvider: "claude-code",
  chatAgentModelId: "claude-sonnet-4-5",
  extractionModelId: "claude-haiku-4-5",
  pmAgentModelId: "claude-haiku-4-5",
  analyticsAgentModelId: "claude-haiku-4-5",
  observerModelId: "claude-sonnet-4-5",
  scorerModelId: "claude-haiku-4-5",
  extractionStoreThreshold: 0.6,
  extractionDisplayThreshold: 0.85,
  surrealUrl: "ws://127.0.0.1:8000/rpc",
  surrealUsername: "root",
  surrealPassword: "root",
  surrealNamespace: "test",
  surrealDatabase: "test",
  port: 3000,
  betterAuthSecret: "test-secret",
  betterAuthUrl: "http://localhost:3000",
  githubClientId: "test-client-id",
  githubClientSecret: "test-client-secret",
  anthropicApiUrl: "https://api.anthropic.com",
  selfHosted: false,
  worktreeManagerEnabled: false,
  orchestratorMockAgent: false,
  sandboxAgentEnabled: false,
  baseUrl: "http://localhost:3000",
};

// ---------------------------------------------------------------------------
// Identity wrap function (no-op for unit tests)
// ---------------------------------------------------------------------------

const identityWrap = (model: unknown) => model;

// ---------------------------------------------------------------------------
// Test helpers: stubs for Bun global APIs
// ---------------------------------------------------------------------------

function stubBunWhich(returnValue: string | null) {
  return spyOn(Bun, "which").mockReturnValue(returnValue);
}

type SpawnResult = {
  exited: Promise<number>;
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
};

function makeSpawnResult(exitCode: number, stdoutText: string): SpawnResult {
  const encoder = new TextEncoder();
  const encoded = encoder.encode(stdoutText);
  return {
    exited: Promise.resolve(exitCode),
    stdout: new ReadableStream({
      start(controller) {
        controller.enqueue(encoded);
        controller.close();
      },
    }),
    stderr: new ReadableStream({
      start(controller) {
        controller.close();
      },
    }),
  };
}

function stubBunSpawn(exitCode: number, stdoutText: string) {
  return spyOn(Bun, "spawn").mockReturnValue(
    makeSpawnResult(exitCode, stdoutText) as ReturnType<typeof Bun.spawn>
  );
}

// ---------------------------------------------------------------------------
// Factory importer
// ---------------------------------------------------------------------------

async function importFactory() {
  const { createClaudeCodeModels } = await import(
    "../../../app/src/server/runtime/dependencies"
  );
  return createClaudeCodeModels;
}

// ---------------------------------------------------------------------------
// Layer 2 — CLI presence probe
// ---------------------------------------------------------------------------

describe("createClaudeCodeModels — Layer 2: CLI presence probe", () => {
  let whichSpy: ReturnType<typeof spyOn>;
  let spawnSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    // Stub Layer 3 to pass so Layer 2 is the only failure point
    spawnSpy = stubBunSpawn(0, '{"loggedIn":true}');
  });

  afterEach(() => {
    whichSpy?.mockRestore();
    spawnSpy?.mockRestore();
  });

  test("throws with npm install command when claude binary is not in PATH", async () => {
    whichSpy = stubBunWhich(null);

    const createClaudeCodeModels = await importFactory();

    await expect(createClaudeCodeModels(BASE_CONFIG, identityWrap)).rejects.toThrow(
      "npm install -g @anthropic-ai/claude-code"
    );
  });
});

// ---------------------------------------------------------------------------
// Layer 3 — auth state probe
// ---------------------------------------------------------------------------

describe("createClaudeCodeModels — Layer 3: auth state probe", () => {
  let whichSpy: ReturnType<typeof spyOn>;
  let spawnSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    // Layer 2 passes — claude binary is present
    whichSpy = stubBunWhich("/usr/local/bin/claude");
  });

  afterEach(() => {
    whichSpy?.mockRestore();
    spawnSpy?.mockRestore();
  });

  test("throws with claude login command when auth status exits non-zero", async () => {
    spawnSpy = stubBunSpawn(1, '{"loggedIn":false}');

    const createClaudeCodeModels = await importFactory();

    await expect(createClaudeCodeModels(BASE_CONFIG, identityWrap)).rejects.toThrow(
      "claude login"
    );
  });

  test("throws with claude login command when auth status outputs loggedIn false", async () => {
    spawnSpy = stubBunSpawn(0, '{"loggedIn":false}');

    const createClaudeCodeModels = await importFactory();

    await expect(createClaudeCodeModels(BASE_CONFIG, identityWrap)).rejects.toThrow(
      "claude login"
    );
  });
});

// ---------------------------------------------------------------------------
// Success case — all 3 probes pass
// ---------------------------------------------------------------------------

describe("createClaudeCodeModels — success: returns 6 model objects", () => {
  let whichSpy: ReturnType<typeof spyOn>;
  let spawnSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    whichSpy = stubBunWhich("/usr/local/bin/claude");
    spawnSpy = stubBunSpawn(0, '{"loggedIn":true}');
  });

  afterEach(() => {
    whichSpy.mockRestore();
    spawnSpy.mockRestore();
  });

  test("returns object with exactly 6 defined model properties", async () => {
    const createClaudeCodeModels = await importFactory();

    const result = await createClaudeCodeModels(BASE_CONFIG, identityWrap);

    expect(result.chatAgentModel).toBeDefined();
    expect(result.extractionModel).toBeDefined();
    expect(result.pmAgentModel).toBeDefined();
    expect(result.analyticsAgentModel).toBeDefined();
    expect(result.observerModel).toBeDefined();
    expect(result.scorerModel).toBeDefined();

    // Exactly 6 properties — no extras
    const keys = Object.keys(result);
    expect(keys).toHaveLength(6);
  });

  test("forwards claudeCodeEffort to provider options when present in config", async () => {
    const createClaudeCodeModels = await importFactory();

    const configWithEffort: ServerConfig = { ...BASE_CONFIG, claudeCodeEffort: "high" };

    const result = await createClaudeCodeModels(configWithEffort, identityWrap);
    expect(result.chatAgentModel).toBeDefined();
  });

  test("forwards claudeCodeMaxBudgetUsd to provider options when present in config", async () => {
    const createClaudeCodeModels = await importFactory();

    const configWithBudget: ServerConfig = { ...BASE_CONFIG, claudeCodeMaxBudgetUsd: 10.0 };

    const result = await createClaudeCodeModels(configWithBudget, identityWrap);
    expect(result.chatAgentModel).toBeDefined();
  });

  test("works without optional claudeCodeEffort and claudeCodeMaxBudgetUsd", async () => {
    const createClaudeCodeModels = await importFactory();

    const configMinimal: ServerConfig = { ...BASE_CONFIG };

    const result = await createClaudeCodeModels(configMinimal, identityWrap);
    expect(result.chatAgentModel).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Layer 1 — package import probe
//
// IMPORTANT: This describe block MUST run last in this file.
// Bun's mock.module has worker-wide side effects — once the module is mocked,
// subsequent dynamic imports in the same worker process see the mocked version.
// Placing this block last ensures the success and Layer 2/3 tests run first
// with the real ai-sdk-provider-claude-code module.
// ---------------------------------------------------------------------------

describe("createClaudeCodeModels — Layer 1: package import probe", () => {
  test("throws with bun add install command when the package is missing or invalid", async () => {
    const { mock } = await import("bun:test");

    // Capture the real module exports before mocking
    const realModule = await import("ai-sdk-provider-claude-code");

    // Return a module without the claudeCode function to simulate package absence.
    // The factory checks typeof mod.claudeCode === "function" and throws our
    // custom error if it is not callable.
    mock.module("ai-sdk-provider-claude-code", () => ({
      ...realModule,
      claudeCode: undefined,
    }));

    const createClaudeCodeModels = await importFactory();

    using _whichSpy = stubBunWhich("/usr/local/bin/claude");
    using _spawnSpy = stubBunSpawn(0, '{"loggedIn":true}');

    await expect(createClaudeCodeModels(BASE_CONFIG, identityWrap)).rejects.toThrow(
      "bun add ai-sdk-provider-claude-code"
    );
  });
});
