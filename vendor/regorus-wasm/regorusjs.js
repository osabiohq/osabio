/* @ts-self-types="./regorusjs.d.ts" */

/**
 * WASM wrapper for [`regorus::Engine`]
 */
class Engine {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        EngineFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_engine_free(ptr, 0);
    }
    /**
     * Add policy data.
     *
     * See https://docs.rs/regorus/latest/regorus/struct.Engine.html#method.add_data
     * * `data`: JSON encoded value to be used as policy data.
     * @param {string} data
     */
    addDataJson(data) {
        const ptr0 = passStringToWasm0(data, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.engine_addDataJson(this.__wbg_ptr, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Add a policy
     *
     * The policy is parsed into AST.
     * See https://docs.rs/regorus/latest/regorus/struct.Engine.html#method.add_policy
     *
     * * `path`: A filename to be associated with the policy.
     * * `rego`: Rego policy.
     * @param {string} path
     * @param {string} rego
     * @returns {string}
     */
    addPolicy(path, rego) {
        let deferred4_0;
        let deferred4_1;
        try {
            const ptr0 = passStringToWasm0(path, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(rego, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            const ret = wasm.engine_addPolicy(this.__wbg_ptr, ptr0, len0, ptr1, len1);
            var ptr3 = ret[0];
            var len3 = ret[1];
            if (ret[3]) {
                ptr3 = 0; len3 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred4_0 = ptr3;
            deferred4_1 = len3;
            return getStringFromWasm0(ptr3, len3);
        } finally {
            wasm.__wbindgen_free(deferred4_0, deferred4_1, 1);
        }
    }
    /**
     * Clear gathered coverage data.
     *
     * See https://docs.rs/regorus/latest/regorus/struct.Engine.html#method.clear_coverage_data
     */
    clearCoverageData() {
        wasm.engine_clearCoverageData(this.__wbg_ptr);
    }
    /**
     * Clear policy data.
     *
     * See https://docs.rs/regorus/0.1.0-alpha.2/regorus/struct.Engine.html#method.clear_data
     */
    clearData() {
        const ret = wasm.engine_clearData(this.__wbg_ptr);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Clear the policy length configuration, reverting to defaults.
     */
    clearPolicyLengthConfig() {
        wasm.engine_clearPolicyLengthConfig(this.__wbg_ptr);
    }
    /**
     * Evaluate query.
     *
     * See https://docs.rs/regorus/0.1.0-alpha.2/regorus/struct.Engine.html#method.eval_query
     * * `query`: Rego expression to be evaluate.
     * @param {string} query
     * @returns {string}
     */
    evalQuery(query) {
        let deferred3_0;
        let deferred3_1;
        try {
            const ptr0 = passStringToWasm0(query, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.engine_evalQuery(this.__wbg_ptr, ptr0, len0);
            var ptr2 = ret[0];
            var len2 = ret[1];
            if (ret[3]) {
                ptr2 = 0; len2 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * Evaluate rule(s) at given path.
     *
     * See https://docs.rs/regorus/latest/regorus/struct.Engine.html#method.eval_rule
     *
     * * `path`: The full path to the rule(s).
     * @param {string} path
     * @returns {string}
     */
    evalRule(path) {
        let deferred3_0;
        let deferred3_1;
        try {
            const ptr0 = passStringToWasm0(path, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.engine_evalRule(this.__wbg_ptr, ptr0, len0);
            var ptr2 = ret[0];
            var len2 = ret[1];
            if (ret[3]) {
                ptr2 = 0; len2 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * Get AST of policies.
     *
     * See https://docs.rs/regorus/latest/regorus/struct.Engine.html#method.get_ast_as_json
     * @returns {string}
     */
    getAstAsJson() {
        let deferred2_0;
        let deferred2_1;
        try {
            const ret = wasm.engine_getAstAsJson(this.__wbg_ptr);
            var ptr1 = ret[0];
            var len1 = ret[1];
            if (ret[3]) {
                ptr1 = 0; len1 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * Get the coverage report as json.
     *
     * See https://docs.rs/regorus/latest/regorus/struct.Engine.html#method.get_coverage_report
     * @returns {string}
     */
    getCoverageReport() {
        let deferred2_0;
        let deferred2_1;
        try {
            const ret = wasm.engine_getCoverageReport(this.__wbg_ptr);
            var ptr1 = ret[0];
            var len1 = ret[1];
            if (ret[3]) {
                ptr1 = 0; len1 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * Get ANSI color coded coverage report.
     *
     * See https://docs.rs/regorus/latest/regorus/coverage/struct.Report.html#method.to_string_pretty
     * @returns {string}
     */
    getCoverageReportPretty() {
        let deferred2_0;
        let deferred2_1;
        try {
            const ret = wasm.engine_getCoverageReportPretty(this.__wbg_ptr);
            var ptr1 = ret[0];
            var len1 = ret[1];
            if (ret[3]) {
                ptr1 = 0; len1 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * Get the list of packages defined by loaded policies.
     *
     * See https://docs.rs/regorus/latest/regorus/struct.Engine.html#method.get_packages
     * @returns {string[]}
     */
    getPackages() {
        const ret = wasm.engine_getPackages(this.__wbg_ptr);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * Get the list of policies.
     *
     * See https://docs.rs/regorus/latest/regorus/struct.Engine.html#method.get_policies
     * @returns {string}
     */
    getPolicies() {
        let deferred2_0;
        let deferred2_1;
        try {
            const ret = wasm.engine_getPolicies(this.__wbg_ptr);
            var ptr1 = ret[0];
            var len1 = ret[1];
            if (ret[3]) {
                ptr1 = 0; len1 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * Construct a new Engine
     *
     * See https://docs.rs/regorus/latest/regorus/struct.Engine.html
     */
    constructor() {
        const ret = wasm.engine_new();
        this.__wbg_ptr = ret >>> 0;
        EngineFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Enable/disable policy coverage.
     *
     * See https://docs.rs/regorus/latest/regorus/struct.Engine.html#method.set_enable_coverage
     * * `b`: Whether to enable gathering coverage or not.
     * @param {boolean} enable
     */
    setEnableCoverage(enable) {
        wasm.engine_setEnableCoverage(this.__wbg_ptr, enable);
    }
    /**
     * Gather output from print statements instead of emiting to stderr.
     *
     * See https://docs.rs/regorus/latest/regorus/struct.Engine.html#method.set_gather_prints
     * * `b`: Whether to enable gathering prints or not.
     * @param {boolean} b
     */
    setGatherPrints(b) {
        wasm.engine_setGatherPrints(this.__wbg_ptr, b);
    }
    /**
     * Set input.
     *
     * See https://docs.rs/regorus/0.1.0-alpha.2/regorus/struct.Engine.html#method.set_input
     * * `input`: JSON encoded value to be used as input to query.
     * @param {string} input
     */
    setInputJson(input) {
        const ptr0 = passStringToWasm0(input, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.engine_setInputJson(this.__wbg_ptr, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Set the policy length limits used when loading policies.
     *
     * Accepts a JS object: `{ maxCol, maxFileBytes, maxLines }`.
     * @param {any} config
     */
    setPolicyLengthConfig(config) {
        const ret = wasm.engine_setPolicyLengthConfig(this.__wbg_ptr, config);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Turn on rego v0.
     *
     * Regorus defaults to rego v1.
     *
     * * `enable`: Whether to enable or disable rego v0.
     * @param {boolean} enable
     */
    setRegoV0(enable) {
        wasm.engine_setRegoV0(this.__wbg_ptr, enable);
    }
    /**
     * Take the gathered output of print statements.
     *
     * See https://docs.rs/regorus/latest/regorus/struct.Engine.html#method.take_prints
     * @returns {string[]}
     */
    takePrints() {
        const ret = wasm.engine_takePrints(this.__wbg_ptr);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
}
if (Symbol.dispose) Engine.prototype[Symbol.dispose] = Engine.prototype.free;
exports.Engine = Engine;

class Program {
    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(Program.prototype);
        obj.__wbg_ptr = ptr;
        ProgramFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        ProgramFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_program_free(ptr, 0);
    }
    /**
     * Compile an RVM program from modules and entry points.
     * @param {string} data_json
     * @param {string} modules_json
     * @param {string} entry_points_json
     * @returns {Program}
     */
    static compileFromModules(data_json, modules_json, entry_points_json) {
        const ptr0 = passStringToWasm0(data_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(modules_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(entry_points_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.program_compileFromModules(ptr0, len0, ptr1, len1, ptr2, len2);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return Program.__wrap(ret[0]);
    }
    /**
     * Deserialize an RVM program from binary format.
     * @param {Uint8Array} data
     * @returns {ProgramDeserializationResult}
     */
    static deserializeBinary(data) {
        const ptr0 = passArray8ToWasm0(data, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.program_deserializeBinary(ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ProgramDeserializationResult.__wrap(ret[0]);
    }
    /**
     * Generate a readable assembly listing.
     * @returns {string}
     */
    generateListing() {
        let deferred2_0;
        let deferred2_1;
        try {
            const ret = wasm.program_generateListing(this.__wbg_ptr);
            var ptr1 = ret[0];
            var len1 = ret[1];
            if (ret[3]) {
                ptr1 = 0; len1 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * Generate a tabular assembly listing.
     * @returns {string}
     */
    generateTabularListing() {
        let deferred2_0;
        let deferred2_1;
        try {
            const ret = wasm.program_generateTabularListing(this.__wbg_ptr);
            var ptr1 = ret[0];
            var len1 = ret[1];
            if (ret[3]) {
                ptr1 = 0; len1 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * Serialize a program to binary format.
     * @returns {Uint8Array}
     */
    serializeBinary() {
        const ret = wasm.program_serializeBinary(this.__wbg_ptr);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
}
if (Symbol.dispose) Program.prototype[Symbol.dispose] = Program.prototype.free;
exports.Program = Program;

class ProgramDeserializationResult {
    static __wrap(ptr) {
        ptr = ptr >>> 0;
        const obj = Object.create(ProgramDeserializationResult.prototype);
        obj.__wbg_ptr = ptr;
        ProgramDeserializationResultFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        ProgramDeserializationResultFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_programdeserializationresult_free(ptr, 0);
    }
    /**
     * Whether the program was partially deserialized.
     * @returns {boolean}
     */
    get isPartial() {
        const ret = wasm.programdeserializationresult_isPartial(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * Get the deserialized program.
     * @returns {Program}
     */
    program() {
        const ret = wasm.programdeserializationresult_program(this.__wbg_ptr);
        return Program.__wrap(ret);
    }
}
if (Symbol.dispose) ProgramDeserializationResult.prototype[Symbol.dispose] = ProgramDeserializationResult.prototype.free;
exports.ProgramDeserializationResult = ProgramDeserializationResult;

class Rvm {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        RvmFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_rvm_free(ptr, 0);
    }
    /**
     * Execute the program and return the JSON result.
     * @returns {string}
     */
    execute() {
        let deferred2_0;
        let deferred2_1;
        try {
            const ret = wasm.rvm_execute(this.__wbg_ptr);
            var ptr1 = ret[0];
            var len1 = ret[1];
            if (ret[3]) {
                ptr1 = 0; len1 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred2_0 = ptr1;
            deferred2_1 = len1;
            return getStringFromWasm0(ptr1, len1);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * Execute an entry point by name and return the JSON result.
     * @param {string} entry_point
     * @returns {string}
     */
    executeEntryPoint(entry_point) {
        let deferred3_0;
        let deferred3_1;
        try {
            const ptr0 = passStringToWasm0(entry_point, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.rvm_executeEntryPoint(this.__wbg_ptr, ptr0, len0);
            var ptr2 = ret[0];
            var len2 = ret[1];
            if (ret[3]) {
                ptr2 = 0; len2 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * Get the execution state as a string.
     * @returns {string}
     */
    getExecutionState() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.rvm_getExecutionState(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * Load a program into the VM.
     * @param {Program} program
     */
    loadProgram(program) {
        _assertClass(program, Program);
        wasm.rvm_loadProgram(this.__wbg_ptr, program.__wbg_ptr);
    }
    constructor() {
        const ret = wasm.rvm_new();
        this.__wbg_ptr = ret >>> 0;
        RvmFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Resume execution with an optional JSON value.
     * @param {string | null} [resume_json]
     * @returns {string}
     */
    resume(resume_json) {
        let deferred3_0;
        let deferred3_1;
        try {
            var ptr0 = isLikeNone(resume_json) ? 0 : passStringToWasm0(resume_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            var len0 = WASM_VECTOR_LEN;
            const ret = wasm.rvm_resume(this.__wbg_ptr, ptr0, len0);
            var ptr2 = ret[0];
            var len2 = ret[1];
            if (ret[3]) {
                ptr2 = 0; len2 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred3_0 = ptr2;
            deferred3_1 = len2;
            return getStringFromWasm0(ptr2, len2);
        } finally {
            wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * Set VM data from JSON.
     * @param {string} data_json
     */
    setDataJson(data_json) {
        const ptr0 = passStringToWasm0(data_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.rvm_setDataJson(this.__wbg_ptr, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Set execution mode (0 = run-to-completion, 1 = suspendable).
     * @param {number} mode
     */
    setExecutionMode(mode) {
        const ret = wasm.rvm_setExecutionMode(this.__wbg_ptr, mode);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Set VM input from JSON.
     * @param {string} input_json
     */
    setInputJson(input_json) {
        const ptr0 = passStringToWasm0(input_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.rvm_setInputJson(this.__wbg_ptr, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
}
if (Symbol.dispose) Rvm.prototype[Symbol.dispose] = Rvm.prototype.free;
exports.Rvm = Rvm;

/**
 * Clear all entries from every pattern cache.
 */
function clearCache() {
    wasm.clearCache();
}
exports.clearCache = clearCache;

/**
 * Configure the global pattern caches used by regex and glob builtins.
 *
 * Accepts a JS object: `{ regex, glob }`.
 * @param {any} config
 */
function setCacheConfig(config) {
    const ret = wasm.setCacheConfig(config);
    if (ret[1]) {
        throw takeFromExternrefTable0(ret[0]);
    }
}
exports.setCacheConfig = setCacheConfig;

function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg_Error_2e59b1b37a9a34c3: function(arg0, arg1) {
            const ret = Error(getStringFromWasm0(arg0, arg1));
            return ret;
        },
        __wbg_Number_e6ffdb596c888833: function(arg0) {
            const ret = Number(arg0);
            return ret;
        },
        __wbg_String_8564e559799eccda: function(arg0, arg1) {
            const ret = String(arg1);
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_bigint_get_as_i64_2c5082002e4826e2: function(arg0, arg1) {
            const v = arg1;
            const ret = typeof(v) === 'bigint' ? v : undefined;
            getDataViewMemory0().setBigInt64(arg0 + 8 * 1, isLikeNone(ret) ? BigInt(0) : ret, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, !isLikeNone(ret), true);
        },
        __wbg___wbindgen_boolean_get_a86c216575a75c30: function(arg0) {
            const v = arg0;
            const ret = typeof(v) === 'boolean' ? v : undefined;
            return isLikeNone(ret) ? 0xFFFFFF : ret ? 1 : 0;
        },
        __wbg___wbindgen_debug_string_dd5d2d07ce9e6c57: function(arg0, arg1) {
            const ret = debugString(arg1);
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_in_4bd7a57e54337366: function(arg0, arg1) {
            const ret = arg0 in arg1;
            return ret;
        },
        __wbg___wbindgen_is_bigint_6c98f7e945dacdde: function(arg0) {
            const ret = typeof(arg0) === 'bigint';
            return ret;
        },
        __wbg___wbindgen_is_object_40c5a80572e8f9d3: function(arg0) {
            const val = arg0;
            const ret = typeof(val) === 'object' && val !== null;
            return ret;
        },
        __wbg___wbindgen_is_undefined_c0cca72b82b86f4d: function(arg0) {
            const ret = arg0 === undefined;
            return ret;
        },
        __wbg___wbindgen_jsval_eq_7d430e744a913d26: function(arg0, arg1) {
            const ret = arg0 === arg1;
            return ret;
        },
        __wbg___wbindgen_jsval_loose_eq_3a72ae764d46d944: function(arg0, arg1) {
            const ret = arg0 == arg1;
            return ret;
        },
        __wbg___wbindgen_number_get_7579aab02a8a620c: function(arg0, arg1) {
            const obj = arg1;
            const ret = typeof(obj) === 'number' ? obj : undefined;
            getDataViewMemory0().setFloat64(arg0 + 8 * 1, isLikeNone(ret) ? 0 : ret, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, !isLikeNone(ret), true);
        },
        __wbg___wbindgen_string_get_914df97fcfa788f2: function(arg0, arg1) {
            const obj = arg1;
            const ret = typeof(obj) === 'string' ? obj : undefined;
            var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            var len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_throw_81fc77679af83bc6: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbg_getRandomValues_3f44b700395062e5: function() { return handleError(function (arg0, arg1) {
            globalThis.crypto.getRandomValues(getArrayU8FromWasm0(arg0, arg1));
        }, arguments); },
        __wbg_getRandomValues_76dfc69825c9c552: function() { return handleError(function (arg0, arg1) {
            globalThis.crypto.getRandomValues(getArrayU8FromWasm0(arg0, arg1));
        }, arguments); },
        __wbg_getRandomValues_d49329ff89a07af1: function() { return handleError(function (arg0, arg1) {
            globalThis.crypto.getRandomValues(getArrayU8FromWasm0(arg0, arg1));
        }, arguments); },
        __wbg_getTime_f6ac312467f7cf09: function(arg0) {
            const ret = arg0.getTime();
            return ret;
        },
        __wbg_getTimezoneOffset_ac5be603b21a5797: function(arg0) {
            const ret = arg0.getTimezoneOffset();
            return ret;
        },
        __wbg_get_with_ref_key_6412cf3094599694: function(arg0, arg1) {
            const ret = arg0[arg1];
            return ret;
        },
        __wbg_instanceof_ArrayBuffer_ff7c1337a5e3b33a: function(arg0) {
            let result;
            try {
                result = arg0 instanceof ArrayBuffer;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_Uint8Array_4b8da683deb25d72: function(arg0) {
            let result;
            try {
                result = arg0 instanceof Uint8Array;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_isSafeInteger_ea83862ba994770c: function(arg0) {
            const ret = Number.isSafeInteger(arg0);
            return ret;
        },
        __wbg_length_0c32cb8543c8e4c8: function(arg0) {
            const ret = arg0.length;
            return ret;
        },
        __wbg_new_0_bfa2ef4bc447daa2: function() {
            const ret = new Date();
            return ret;
        },
        __wbg_new_0f6d2ddfe083319b: function(arg0) {
            const ret = new Date(arg0);
            return ret;
        },
        __wbg_new_a560378ea1240b14: function(arg0) {
            const ret = new Uint8Array(arg0);
            return ret;
        },
        __wbg_prototypesetcall_3e05eb9545565046: function(arg0, arg1, arg2) {
            Uint8Array.prototype.set.call(getArrayU8FromWasm0(arg0, arg1), arg2);
        },
        __wbindgen_cast_0000000000000001: function(arg0) {
            // Cast intrinsic for `F64 -> Externref`.
            const ret = arg0;
            return ret;
        },
        __wbindgen_cast_0000000000000002: function(arg0, arg1) {
            // Cast intrinsic for `Ref(String) -> Externref`.
            const ret = getStringFromWasm0(arg0, arg1);
            return ret;
        },
        __wbindgen_cast_0000000000000003: function(arg0) {
            // Cast intrinsic for `U64 -> Externref`.
            const ret = BigInt.asUintN(64, arg0);
            return ret;
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./regorusjs_bg.js": import0,
    };
}

const EngineFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_engine_free(ptr >>> 0, 1));
const ProgramFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_program_free(ptr >>> 0, 1));
const ProgramDeserializationResultFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_programdeserializationresult_free(ptr >>> 0, 1));
const RvmFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_rvm_free(ptr >>> 0, 1));

function addToExternrefTable0(obj) {
    const idx = wasm.__externref_table_alloc();
    wasm.__wbindgen_externrefs.set(idx, obj);
    return idx;
}

function _assertClass(instance, klass) {
    if (!(instance instanceof klass)) {
        throw new Error(`expected instance of ${klass.name}`);
    }
}

function debugString(val) {
    // primitive types
    const type = typeof val;
    if (type == 'number' || type == 'boolean' || val == null) {
        return  `${val}`;
    }
    if (type == 'string') {
        return `"${val}"`;
    }
    if (type == 'symbol') {
        const description = val.description;
        if (description == null) {
            return 'Symbol';
        } else {
            return `Symbol(${description})`;
        }
    }
    if (type == 'function') {
        const name = val.name;
        if (typeof name == 'string' && name.length > 0) {
            return `Function(${name})`;
        } else {
            return 'Function';
        }
    }
    // objects
    if (Array.isArray(val)) {
        const length = val.length;
        let debug = '[';
        if (length > 0) {
            debug += debugString(val[0]);
        }
        for(let i = 1; i < length; i++) {
            debug += ', ' + debugString(val[i]);
        }
        debug += ']';
        return debug;
    }
    // Test for built-in
    const builtInMatches = /\[object ([^\]]+)\]/.exec(toString.call(val));
    let className;
    if (builtInMatches && builtInMatches.length > 1) {
        className = builtInMatches[1];
    } else {
        // Failed to match the standard '[object ClassName]'
        return toString.call(val);
    }
    if (className == 'Object') {
        // we're a user defined class or Object
        // JSON.stringify avoids problems with cycles, and is generally much
        // easier than looping through ownProperties of `val`.
        try {
            return 'Object(' + JSON.stringify(val) + ')';
        } catch (_) {
            return 'Object';
        }
    }
    // errors
    if (val instanceof Error) {
        return `${val.name}: ${val.message}\n${val.stack}`;
    }
    // TODO we could test for more things here, like `Set`s and `Map`s.
    return className;
}

function getArrayJsValueFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    const mem = getDataViewMemory0();
    const result = [];
    for (let i = ptr; i < ptr + 4 * len; i += 4) {
        result.push(wasm.__wbindgen_externrefs.get(mem.getUint32(i, true)));
    }
    wasm.__externref_drop_slice(ptr, len);
    return result;
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedDataViewMemory0 = null;
function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

function getStringFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return decodeText(ptr, len);
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function handleError(f, args) {
    try {
        return f.apply(this, args);
    } catch (e) {
        const idx = addToExternrefTable0(e);
        wasm.__wbindgen_exn_store(idx);
    }
}

function isLikeNone(x) {
    return x === undefined || x === null;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_externrefs.get(idx);
    wasm.__externref_table_dealloc(idx);
    return value;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
function decodeText(ptr, len) {
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;

const wasmPath = `${__dirname}/regorusjs_bg.wasm`;
const wasmBytes = require('fs').readFileSync(wasmPath);
const wasmModule = new WebAssembly.Module(wasmBytes);
let wasm = new WebAssembly.Instance(wasmModule, __wbg_get_imports()).exports;
wasm.__wbindgen_start();
