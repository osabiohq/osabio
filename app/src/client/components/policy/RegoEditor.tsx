/**
 * RegoEditor: CodeMirror 5 editor with Rego syntax highlighting.
 *
 * Uses direct CodeMirror 5 integration (no react-codemirror2 wrapper) to
 * avoid double-render issues with React StrictMode and Dialog mounts.
 *
 * Features:
 * - Rego syntax highlighting (codemirror-rego mode)
 * - Line numbers
 * - Bracket matching
 * - Optional read-only mode
 * - Optional validation (calls POST /policies/validate)
 */

import { useCallback, useEffect, useRef, useState } from "react";
import CodeMirror from "codemirror";
import { useWorkspaceState } from "../../stores/workspace-state";
import "codemirror/lib/codemirror.css";
import "codemirror/theme/material-darker.css";
import "codemirror/addon/edit/matchbrackets";
import "codemirror-rego/mode";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ValidationError = {
  line: number;
  column: number;
  message: string;
};

type ValidationResult =
  | { success: true }
  | { success: false; errors: ValidationError[] };

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function formatValidationError(error: ValidationError): string {
  return `Line ${error.line}, Col ${error.column}: ${error.message}`;
}

async function validateRegoSource(
  workspaceId: string,
  regoSource: string,
): Promise<ValidationResult> {
  const url = `/api/workspaces/${encodeURIComponent(workspaceId)}/policies/validate`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rego_source: regoSource }),
  });
  if (!response.ok) {
    const text = await response.text();
    let message: string;
    try {
      const parsed = JSON.parse(text) as { error?: string };
      message = parsed.error ?? text;
    } catch {
      message = text;
    }
    return { success: false, errors: [{ line: 0, column: 0, message }] };
  }
  return (await response.json()) as ValidationResult;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

type RegoEditorProps = {
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  showValidate?: boolean;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function RegoEditor({ value, onChange, readOnly = false, showValidate = false }: RegoEditorProps) {
  const workspaceId = useWorkspaceState((s) => s.workspaceId);
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<CodeMirror.Editor | undefined>(undefined);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const [isValidating, setIsValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<ValidationResult | undefined>();

  // Initialize CodeMirror once on mount, destroy on unmount
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const editor = CodeMirror(container, {
      value,
      mode: "rego",
      lineNumbers: true,
      gutters: ["CodeMirror-linenumbers", "error-gutter"],
      matchBrackets: true,
      readOnly: readOnly ? true : false,
      theme: "material-darker",
    });

    editor.on("change", (instance) => {
      onChangeRef.current(instance.getValue());
    });

    editorRef.current = editor;

    return () => {
      const wrapper = editor.getWrapperElement();
      wrapper.parentNode?.removeChild(wrapper);
      editorRef.current = undefined;
    };
    // Only run on mount/unmount — value synced separately below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly]);

  // Sync external value changes into the editor (e.g. form reset)
  useEffect(() => {
    const editor = editorRef.current;
    if (editor && editor.getValue() !== value) {
      editor.setValue(value);
    }
  }, [value]);

  const handleValidate = useCallback(async () => {
    if (!workspaceId || !value.trim()) return;
    setIsValidating(true);
    setValidationResult(undefined);
    try {
      const result = await validateRegoSource(workspaceId, value);
      setValidationResult(result);

      // Add gutter markers on error lines
      const editor = editorRef.current;
      if (editor) {
        editor.clearGutter("error-gutter");
        if (!result.success) {
          for (const error of result.errors) {
            const lineIndex = Math.max(0, error.line - 1);
            const marker = document.createElement("div");
            marker.className = "error-marker";
            marker.title = error.message;
            editor.setGutterMarker(lineIndex, "error-gutter", marker);
          }
        }
      }
    } catch (err) {
      setValidationResult({
        success: false,
        errors: [{ line: 0, column: 0, message: err instanceof Error ? err.message : "Validation failed" }],
      });
    } finally {
      setIsValidating(false);
    }
  }, [workspaceId, value]);

  // Clear validation state when content changes
  useEffect(() => {
    setValidationResult(undefined);
    const editor = editorRef.current;
    if (editor) {
      editor.clearGutter("error-gutter");
    }
  }, [value]);

  return (
    <div className="flex flex-col gap-2">
      <style>{`
        .error-gutter { width: 16px; }
        .error-marker {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background-color: rgb(239, 68, 68);
          margin: 2px auto;
          cursor: pointer;
        }
      `}</style>
      <div ref={containerRef} className="overflow-hidden rounded-md border border-border [&_.CodeMirror]:h-auto" />

      {showValidate && !readOnly && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => { void handleValidate(); }}
              disabled={isValidating || !value.trim()}
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50"
            >
              {isValidating ? "Validating..." : "Validate"}
            </button>

            {validationResult?.success === true && (
              <span className="flex items-center gap-1 text-xs text-green-600">
                <span aria-hidden>&#10003;</span> Valid Rego
              </span>
            )}
          </div>

          {validationResult && !validationResult.success && (
            <div className="flex flex-col gap-0.5 rounded-md border border-destructive/40 bg-destructive/10 p-2">
              {validationResult.errors.map((error, index) => (
                <p key={index} className="text-xs text-destructive">
                  {formatValidationError(error)}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
