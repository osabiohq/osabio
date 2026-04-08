/**
 * RegoEditor: CodeMirror 5 editor with Rego syntax highlighting.
 *
 * Wraps react-codemirror2 Controlled component with:
 * - Rego syntax highlighting (codemirror-rego mode)
 * - Line numbers
 * - Bracket matching
 * - Optional read-only mode
 * - Optional validation (calls POST /policies/validate)
 */

import { useCallback, useRef, useState } from "react";
import { Controlled as CodeMirror } from "react-codemirror2";
import { useWorkspaceState } from "../../stores/workspace-state";
import "codemirror/lib/codemirror.css";
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
  const editorRef = useRef<import("codemirror").Editor | undefined>(undefined);

  const [isValidating, setIsValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<ValidationResult | undefined>();

  const handleValidate = useCallback(async () => {
    if (!workspaceId || !value.trim()) return;
    setIsValidating(true);
    setValidationResult(undefined);
    try {
      const result = await validateRegoSource(workspaceId, value);
      setValidationResult(result);

      // Highlight error lines in the editor
      const editor = editorRef.current;
      if (editor && !result.success) {
        for (const error of result.errors) {
          const lineIndex = Math.max(0, error.line - 1);
          editor.addLineClass(lineIndex, "background", "cm-error-line");
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

  const handleBeforeChange = useCallback(
    (_editor: unknown, _data: unknown, newValue: string) => {
      if (!readOnly) {
        setValidationResult(undefined);
        // Clear error line highlights
        const editor = editorRef.current;
        if (editor) {
          const lineCount = editor.lineCount();
          for (let i = 0; i < lineCount; i++) {
            editor.removeLineClass(i, "background", "cm-error-line");
          }
        }
        onChange(newValue);
      }
    },
    [readOnly, onChange],
  );

  const options: import("codemirror").EditorConfiguration = {
    mode: "rego",
    lineNumbers: true,
    matchBrackets: true,
    readOnly: readOnly ? true : false,
    theme: "default",
  };

  return (
    <div className="flex flex-col gap-2">
      <style>{`.cm-error-line { background-color: rgba(239, 68, 68, 0.15); }`}</style>
      <div className="overflow-hidden rounded-md border border-border">
        <CodeMirror
          value={value}
          options={options}
          onBeforeChange={handleBeforeChange}
          editorDidMount={(editor) => { editorRef.current = editor; }}
        />
      </div>

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
