import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { loadServerConfig } from "../../../app/src/server/runtime/config";

/**
 * Tests for claude-code inference provider config fields:
 * - InferenceProvider includes "claude-code"
 * - ServerConfig has claudeCodeEffort?: "low" | "normal" | "high"
 * - ServerConfig has claudeCodeMaxBudgetUsd?: number
 * - OPENROUTER_API_KEY not required when INFERENCE_PROVIDER=claude-code
 * - OPENROUTER_API_KEY still required when INFERENCE_PROVIDER=openrouter
 * - CLAUDE_CODE_EFFORT enum validation
 * - CLAUDE_CODE_MAX_BUDGET_USD numeric validation
 * - parseInferenceProvider error message lists all three valid values
 *
 * Behaviors under test:
 * 1. INFERENCE_PROVIDER=claude-code accepted without OPENROUTER_API_KEY
 * 2. INFERENCE_PROVIDER=openrouter without OPENROUTER_API_KEY still throws
 * 3. CLAUDE_CODE_EFFORT=high parses to "high"
 * 4. CLAUDE_CODE_EFFORT=invalid throws listing low, normal, high
 * 5. CLAUDE_CODE_MAX_BUDGET_USD=5.0 parses to 5
 * 6. CLAUDE_CODE_MAX_BUDGET_USD=abc throws
 * 7. parseInferenceProvider error lists openrouter, ollama, claude-code
 * 8. claudeCodeEffort absent when INFERENCE_PROVIDER!=claude-code
 * 9. claudeCodeMaxBudgetUsd absent when INFERENCE_PROVIDER!=claude-code
 */

const BASE_ENV: Record<string, string> = {
  CHAT_AGENT_MODEL: "test-chat-model",
  EXTRACTION_MODEL: "test-extraction-model",
  ANALYTICS_MODEL: "test-analytics-model",
  EXTRACTION_STORE_THRESHOLD: "0.6",
  EXTRACTION_DISPLAY_THRESHOLD: "0.85",
  SURREAL_URL: "ws://127.0.0.1:8000/rpc",
  SURREAL_USERNAME: "root",
  SURREAL_PASSWORD: "root",
  SURREAL_NAMESPACE: "test",
  SURREAL_DATABASE: "test",
  PORT: "3000",
  BETTER_AUTH_SECRET: "test-secret",
  BETTER_AUTH_URL: "http://localhost:3000",
  GITHUB_CLIENT_ID: "test-client-id",
  GITHUB_CLIENT_SECRET: "test-client-secret",
};

const CLAUDE_CODE_VARS = [
  "INFERENCE_PROVIDER",
  "OPENROUTER_API_KEY",
  "CLAUDE_CODE_EFFORT",
  "CLAUDE_CODE_MAX_BUDGET_USD",
] as const;

describe("claude-code inference provider config", () => {
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = { ...Bun.env };
    for (const [key, value] of Object.entries(BASE_ENV)) {
      Bun.env[key] = value;
    }
    for (const key of CLAUDE_CODE_VARS) {
      delete Bun.env[key];
    }
  });

  afterEach(() => {
    for (const key of [...Object.keys(BASE_ENV), ...CLAUDE_CODE_VARS]) {
      if (savedEnv[key] !== undefined) {
        Bun.env[key] = savedEnv[key];
      } else {
        delete Bun.env[key];
      }
    }
  });

  describe("InferenceProvider union", () => {
    test("accepts claude-code without OPENROUTER_API_KEY", () => {
      Bun.env.INFERENCE_PROVIDER = "claude-code";
      const config = loadServerConfig();
      expect(config.inferenceProvider).toBe("claude-code");
    });

    test("throws for unknown provider listing all three valid values", () => {
      Bun.env.INFERENCE_PROVIDER = "unknown-provider";
      expect(() => loadServerConfig()).toThrow(
        "INFERENCE_PROVIDER must be one of: openrouter, ollama, claude-code",
      );
    });

    test("still requires OPENROUTER_API_KEY when provider is openrouter", () => {
      Bun.env.INFERENCE_PROVIDER = "openrouter";
      delete Bun.env.OPENROUTER_API_KEY;
      expect(() => loadServerConfig()).toThrow("OPENROUTER_API_KEY is required");
    });

    test("openrouterApiKey absent when provider is claude-code", () => {
      Bun.env.INFERENCE_PROVIDER = "claude-code";
      const config = loadServerConfig();
      expect(config.openRouterApiKey).toBeUndefined();
    });
  });

  describe("CLAUDE_CODE_EFFORT", () => {
    test("parses 'high' as high", () => {
      Bun.env.INFERENCE_PROVIDER = "claude-code";
      Bun.env.CLAUDE_CODE_EFFORT = "high";
      const config = loadServerConfig();
      expect(config.claudeCodeEffort).toBe("high");
    });

    test("parses 'normal' as normal", () => {
      Bun.env.INFERENCE_PROVIDER = "claude-code";
      Bun.env.CLAUDE_CODE_EFFORT = "normal";
      const config = loadServerConfig();
      expect(config.claudeCodeEffort).toBe("normal");
    });

    test("parses 'low' as low", () => {
      Bun.env.INFERENCE_PROVIDER = "claude-code";
      Bun.env.CLAUDE_CODE_EFFORT = "low";
      const config = loadServerConfig();
      expect(config.claudeCodeEffort).toBe("low");
    });

    test("throws for invalid value listing allowed values", () => {
      Bun.env.INFERENCE_PROVIDER = "claude-code";
      Bun.env.CLAUDE_CODE_EFFORT = "invalid";
      expect(() => loadServerConfig()).toThrow("low");
      expect(() => loadServerConfig()).toThrow("normal");
      expect(() => loadServerConfig()).toThrow("high");
    });

    test("claudeCodeEffort absent when not set", () => {
      Bun.env.INFERENCE_PROVIDER = "claude-code";
      const config = loadServerConfig();
      expect(config.claudeCodeEffort).toBeUndefined();
    });

    test("claudeCodeEffort absent when provider is not claude-code", () => {
      Bun.env.INFERENCE_PROVIDER = "openrouter";
      Bun.env.OPENROUTER_API_KEY = "test-key";
      Bun.env.CLAUDE_CODE_EFFORT = "high";
      const config = loadServerConfig();
      expect(config.claudeCodeEffort).toBeUndefined();
    });
  });

  describe("CLAUDE_CODE_MAX_BUDGET_USD", () => {
    test("parses '5.0' as 5", () => {
      Bun.env.INFERENCE_PROVIDER = "claude-code";
      Bun.env.CLAUDE_CODE_MAX_BUDGET_USD = "5.0";
      const config = loadServerConfig();
      expect(config.claudeCodeMaxBudgetUsd).toBe(5);
    });

    test("parses '10' as 10", () => {
      Bun.env.INFERENCE_PROVIDER = "claude-code";
      Bun.env.CLAUDE_CODE_MAX_BUDGET_USD = "10";
      const config = loadServerConfig();
      expect(config.claudeCodeMaxBudgetUsd).toBe(10);
    });

    test("throws for non-numeric value", () => {
      Bun.env.INFERENCE_PROVIDER = "claude-code";
      Bun.env.CLAUDE_CODE_MAX_BUDGET_USD = "abc";
      expect(() => loadServerConfig()).toThrow();
    });

    test("throws for non-positive value", () => {
      Bun.env.INFERENCE_PROVIDER = "claude-code";
      Bun.env.CLAUDE_CODE_MAX_BUDGET_USD = "0";
      expect(() => loadServerConfig()).toThrow();
    });

    test("claudeCodeMaxBudgetUsd absent when not set", () => {
      Bun.env.INFERENCE_PROVIDER = "claude-code";
      const config = loadServerConfig();
      expect(config.claudeCodeMaxBudgetUsd).toBeUndefined();
    });

    test("claudeCodeMaxBudgetUsd absent when provider is not claude-code", () => {
      Bun.env.INFERENCE_PROVIDER = "openrouter";
      Bun.env.OPENROUTER_API_KEY = "test-key";
      Bun.env.CLAUDE_CODE_MAX_BUDGET_USD = "5.0";
      const config = loadServerConfig();
      expect(config.claudeCodeMaxBudgetUsd).toBeUndefined();
    });
  });
});
