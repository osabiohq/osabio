/**
 * Acceptance test: BM25 fulltext indexes for learning and policy tables.
 *
 * Verifies that migration 0062 adds BM25 fulltext indexes on:
 *   - learning.text
 *   - policy.description
 *
 * These indexes are required by all Phase 1 steps of the remove-embeddings feature,
 * enabling fulltext search to replace vector/embedding-based search.
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Surreal } from "surrealdb";
import { applyTestSchema } from "../acceptance-test-kit";

const surrealUrl = process.env.SURREAL_URL ?? "ws://127.0.0.1:8000/rpc";
const surrealUsername = process.env.SURREAL_USERNAME ?? "root";
const surrealPassword = process.env.SURREAL_PASSWORD ?? "root";

describe("BM25 fulltext indexes migration (0062)", () => {
  let surreal: Surreal;
  const namespace = `bm25_idx_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const database = `bm25_test_${Math.floor(Math.random() * 100000)}`;

  beforeAll(async () => {
    surreal = new Surreal();
    await surreal.connect(surrealUrl);
    await surreal.signin({ username: surrealUsername, password: surrealPassword });
    await surreal.query(`DEFINE NAMESPACE ${namespace};`);
    await surreal.use({ namespace });
    await surreal.query(`DEFINE DATABASE ${database};`);
    await surreal.use({ namespace, database });

    // Apply base schema
    await applyTestSchema(surreal);

    // Apply migration 0002 (defines entity_search analyzer + existing fulltext indexes)
    const migration0002 = readFileSync(
      join(process.cwd(), "schema", "migrations", "0002_fulltext_search_indexes.surql"),
      "utf8",
    );
    await surreal.query(migration0002);

    // Apply migration 0062 (new learning + policy fulltext indexes)
    const migration0062 = readFileSync(
      join(process.cwd(), "schema", "migrations", "0062_bm25_indexes_for_embedding_replacement.surql"),
      "utf8",
    );
    await surreal.query(migration0062);
  });

  afterAll(async () => {
    try {
      await surreal.query(`REMOVE DATABASE ${database};`);
      await surreal.query(`REMOVE NAMESPACE ${namespace};`);
    } finally {
      await surreal.close();
    }
  });

  test("learning table has BM25 fulltext index on text field", async () => {
    const [info] = await surreal.query<[Record<string, unknown>]>(
      "INFO FOR TABLE learning;",
    );
    const indexes = info.indexes as Record<string, string>;
    const indexDef = indexes.idx_learning_fulltext;

    expect(indexDef).toBeDefined();
    expect(indexDef).toContain("FULLTEXT ANALYZER entity_search BM25");
    expect(indexDef).toContain("FIELDS text");
  });

  test("policy table has BM25 fulltext index on description field", async () => {
    const [info] = await surreal.query<[Record<string, unknown>]>(
      "INFO FOR TABLE policy;",
    );
    const indexes = info.indexes as Record<string, string>;
    const indexDef = indexes.idx_policy_fulltext;

    expect(indexDef).toBeDefined();
    expect(indexDef).toContain("FULLTEXT ANALYZER entity_search BM25");
    expect(indexDef).toContain("FIELDS description");
  });

  test("BM25 fulltext match works for learning.text", async () => {
    // Seed a learning record with workspace reference
    await surreal.query(`
      CREATE workspace:bm25test SET
        name = 'test',
        status = 'active',
        onboarding_complete = true,
        onboarding_turn_count = 0,
        onboarding_summary_pending = false,
        onboarding_started_at = time::now(),
        created_at = time::now();
      CREATE learning:testlearn SET
        text = 'Always validate input parameters before processing',
        learning_type = 'instruction',
        status = 'active',
        source = 'human',
        priority = 'medium',
        target_agents = ['coding'],
        workspace = workspace:bm25test,
        created_at = time::now();
    `);

    // Verify fulltext match operator works against the index
    const [results] = await surreal.query<[Array<{ id: unknown }>]>(
      `SELECT id FROM learning WHERE text @1@ 'validate input';`,
    );

    expect(results.length).toBe(1);

    // Verify non-matching query returns empty
    const [noResults] = await surreal.query<[Array<{ id: unknown }>]>(
      `SELECT id FROM learning WHERE text @1@ 'xyznonexistent';`,
    );

    expect(noResults.length).toBe(0);
  });

  test("BM25 fulltext match works for policy.description", async () => {
    // Seed a policy record
    await surreal.query(`
      CREATE identity:bm25admin SET
        name = 'Test Admin',
        type = 'human',
        workspace = workspace:bm25test,
        created_at = time::now();
      CREATE policy:testpol SET
        title = 'Rate Limiting Policy',
        description = 'Enforce rate limiting on all external API endpoints',
        version = 1,
        status = 'draft',
        selector = { workspace: 'test' },
        rego_source = 'package osabio.policy\ndefault allow = true',
        human_veto_required = false,
        created_by = identity:bm25admin,
        workspace = workspace:bm25test,
        created_at = time::now(),
        updated_at = time::now();
    `);

    // Verify fulltext match operator works against the index
    const [results] = await surreal.query<[Array<{ id: unknown }>]>(
      `SELECT id FROM policy WHERE description @1@ 'rate limiting';`,
    );

    expect(results.length).toBe(1);

    // Verify non-matching query returns empty
    const [noResults] = await surreal.query<[Array<{ id: unknown }>]>(
      `SELECT id FROM policy WHERE description @1@ 'xyznonexistent';`,
    );

    expect(noResults.length).toBe(0);
  });
});
