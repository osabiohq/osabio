/* tslint:disable */
/* eslint-disable */

/**
 * WASM wrapper for [`regorus::Engine`]
 */
export class Engine {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Add policy data.
     *
     * See https://docs.rs/regorus/latest/regorus/struct.Engine.html#method.add_data
     * * `data`: JSON encoded value to be used as policy data.
     */
    addDataJson(data: string): void;
    /**
     * Add a policy
     *
     * The policy is parsed into AST.
     * See https://docs.rs/regorus/latest/regorus/struct.Engine.html#method.add_policy
     *
     * * `path`: A filename to be associated with the policy.
     * * `rego`: Rego policy.
     */
    addPolicy(path: string, rego: string): string;
    /**
     * Clear gathered coverage data.
     *
     * See https://docs.rs/regorus/latest/regorus/struct.Engine.html#method.clear_coverage_data
     */
    clearCoverageData(): void;
    /**
     * Clear policy data.
     *
     * See https://docs.rs/regorus/0.1.0-alpha.2/regorus/struct.Engine.html#method.clear_data
     */
    clearData(): void;
    /**
     * Clear the policy length configuration, reverting to defaults.
     */
    clearPolicyLengthConfig(): void;
    /**
     * Evaluate query.
     *
     * See https://docs.rs/regorus/0.1.0-alpha.2/regorus/struct.Engine.html#method.eval_query
     * * `query`: Rego expression to be evaluate.
     */
    evalQuery(query: string): string;
    /**
     * Evaluate rule(s) at given path.
     *
     * See https://docs.rs/regorus/latest/regorus/struct.Engine.html#method.eval_rule
     *
     * * `path`: The full path to the rule(s).
     */
    evalRule(path: string): string;
    /**
     * Get AST of policies.
     *
     * See https://docs.rs/regorus/latest/regorus/struct.Engine.html#method.get_ast_as_json
     */
    getAstAsJson(): string;
    /**
     * Get the coverage report as json.
     *
     * See https://docs.rs/regorus/latest/regorus/struct.Engine.html#method.get_coverage_report
     */
    getCoverageReport(): string;
    /**
     * Get ANSI color coded coverage report.
     *
     * See https://docs.rs/regorus/latest/regorus/coverage/struct.Report.html#method.to_string_pretty
     */
    getCoverageReportPretty(): string;
    /**
     * Get the list of packages defined by loaded policies.
     *
     * See https://docs.rs/regorus/latest/regorus/struct.Engine.html#method.get_packages
     */
    getPackages(): string[];
    /**
     * Get the list of policies.
     *
     * See https://docs.rs/regorus/latest/regorus/struct.Engine.html#method.get_policies
     */
    getPolicies(): string;
    /**
     * Construct a new Engine
     *
     * See https://docs.rs/regorus/latest/regorus/struct.Engine.html
     */
    constructor();
    /**
     * Enable/disable policy coverage.
     *
     * See https://docs.rs/regorus/latest/regorus/struct.Engine.html#method.set_enable_coverage
     * * `b`: Whether to enable gathering coverage or not.
     */
    setEnableCoverage(enable: boolean): void;
    /**
     * Gather output from print statements instead of emiting to stderr.
     *
     * See https://docs.rs/regorus/latest/regorus/struct.Engine.html#method.set_gather_prints
     * * `b`: Whether to enable gathering prints or not.
     */
    setGatherPrints(b: boolean): void;
    /**
     * Set input.
     *
     * See https://docs.rs/regorus/0.1.0-alpha.2/regorus/struct.Engine.html#method.set_input
     * * `input`: JSON encoded value to be used as input to query.
     */
    setInputJson(input: string): void;
    /**
     * Set the policy length limits used when loading policies.
     *
     * Accepts a JS object: `{ maxCol, maxFileBytes, maxLines }`.
     */
    setPolicyLengthConfig(config: any): void;
    /**
     * Turn on rego v0.
     *
     * Regorus defaults to rego v1.
     *
     * * `enable`: Whether to enable or disable rego v0.
     */
    setRegoV0(enable: boolean): void;
    /**
     * Take the gathered output of print statements.
     *
     * See https://docs.rs/regorus/latest/regorus/struct.Engine.html#method.take_prints
     */
    takePrints(): string[];
}

export class Program {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Compile an RVM program from modules and entry points.
     */
    static compileFromModules(data_json: string, modules_json: string, entry_points_json: string): Program;
    /**
     * Deserialize an RVM program from binary format.
     */
    static deserializeBinary(data: Uint8Array): ProgramDeserializationResult;
    /**
     * Generate a readable assembly listing.
     */
    generateListing(): string;
    /**
     * Generate a tabular assembly listing.
     */
    generateTabularListing(): string;
    /**
     * Serialize a program to binary format.
     */
    serializeBinary(): Uint8Array;
}

export class ProgramDeserializationResult {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Get the deserialized program.
     */
    program(): Program;
    /**
     * Whether the program was partially deserialized.
     */
    readonly isPartial: boolean;
}

export class Rvm {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Execute the program and return the JSON result.
     */
    execute(): string;
    /**
     * Execute an entry point by name and return the JSON result.
     */
    executeEntryPoint(entry_point: string): string;
    /**
     * Get the execution state as a string.
     */
    getExecutionState(): string;
    /**
     * Load a program into the VM.
     */
    loadProgram(program: Program): void;
    constructor();
    /**
     * Resume execution with an optional JSON value.
     */
    resume(resume_json?: string | null): string;
    /**
     * Set VM data from JSON.
     */
    setDataJson(data_json: string): void;
    /**
     * Set execution mode (0 = run-to-completion, 1 = suspendable).
     */
    setExecutionMode(mode: number): void;
    /**
     * Set VM input from JSON.
     */
    setInputJson(input_json: string): void;
}

/**
 * Clear all entries from every pattern cache.
 */
export function clearCache(): void;

/**
 * Configure the global pattern caches used by regex and glob builtins.
 *
 * Accepts a JS object: `{ regex, glob }`.
 */
export function setCacheConfig(config: any): void;
