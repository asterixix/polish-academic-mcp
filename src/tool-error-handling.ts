/**
 * Centralized tool error handling, debugging, and structured error reporting.
 *
 * Provides:
 * - Structured error types with full context
 * - Debug logging with request/response inspection
 * - HTTP error analysis with recovery suggestions
 * - JSON/XML parsing error details
 * - Rate limit and timeout detection
 * - Diagnostic context capture for troubleshooting
 */

// ─────────────────────────────────────────────────────────────────────────────
// Error Types
// ─────────────────────────────────────────────────────────────────────────────

export type ToolErrorType =
  | "network_error"
  | "http_error"
  | "timeout"
  | "parsing_error"
  | "rate_limit"
  | "auth_error"
  | "validation_error"
  | "cache_error"
  | "api_error"
  | "unknown_error";

export interface ToolErrorContext {
  toolName: string;
  operation?: string;
  url?: string;
  params?: Record<string, unknown>;
  requestBody?: string;
  responseBody?: string;
  httpStatus?: number;
  headers?: Record<string, string>;
  timestamp: number;
  duration?: number; // milliseconds
}

export interface ToolErrorReport {
  type: ToolErrorType;
  message: string;
  context: ToolErrorContext;
  suggestion?: string;
  debugInfo: DebugInfo;
  originalError: Error | null;
}

export interface DebugInfo {
  errorStack?: string;
  parseErrorDetails?: string;
  httpErrorDetails?: string;
  rateLimitHeaders?: Record<string, string>;
  retryable: boolean;
  recoverySteps?: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Error Analysis Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Analyze HTTP error status code and provide debug info.
 */
function analyzeHttpError(
  status: number,
  _statusText: string,
  headers?: Record<string, string>,
): {
  type: ToolErrorType;
  suggestion: string;
  retryable: boolean;
  rateLimitHeaders?: Record<string, string>;
} {
  // Rate limiting
  if (status === 429) {
    const rateLimitHeaders = headers
      ? {
          "Retry-After": headers["retry-after"] || "unknown",
          "X-RateLimit-Limit": headers["x-ratelimit-limit"] || "unknown",
          "X-RateLimit-Remaining": headers["x-ratelimit-remaining"] || "unknown",
          "X-RateLimit-Reset": headers["x-ratelimit-reset"] || "unknown",
        }
      : undefined;
    return {
      type: "rate_limit",
      suggestion:
        "API rate limit exceeded. Wait before retrying. Check Retry-After header. Consider batching requests or implementing exponential backoff.",
      retryable: true,
      rateLimitHeaders,
    };
  }

  // Authentication errors
  if (status === 401 || status === 403) {
    return {
      type: "auth_error",
      suggestion:
        status === 401
          ? "Authentication failed. Verify API credentials (APP_ID, APP_TOKEN, secrets). Check for expired or revoked tokens."
          : "Access forbidden. Insufficient permissions. Verify service account scope or contact API provider.",
      retryable: false,
    };
  }

  // Client errors
  if (status >= 400 && status < 500) {
    if (status === 404) {
      return {
        type: "api_error",
        suggestion:
          "Resource not found. Verify URL, parameters, and resource ID. Check for typos or outdated API structure.",
        retryable: false,
      };
    }
    if (status === 400) {
      return {
        type: "validation_error",
        suggestion:
          "Bad request. Validate request body structure, field types, parameter formats, and encoding.",
        retryable: false,
      };
    }
    return {
      type: "http_error",
      suggestion: `HTTP ${status} error. Review request parameters and API requirements.`,
      retryable: false,
    };
  }

  // Server errors
  if (status >= 500) {
    return {
      type: "http_error",
      suggestion: `Server error (${status}). API may be temporarily unavailable. Implement retry logic with exponential backoff.`,
      retryable: true,
    };
  }

  return {
    type: "http_error",
    suggestion: `Unexpected HTTP status ${status}. Check API documentation.`,
    retryable: false,
  };
}

/**
 * Analyze JSON parsing error and suggest fixes.
 */
function analyzeJsonError(
  jsonString: string,
  err: SyntaxError,
): { details: string; recoverySteps: string[] } {
  const preview = jsonString.slice(0, 200);
  const match = err.message.match(/position (\d+)/);
  const position = match ? parseInt(match[1], 10) : null;

  const context = position
    ? jsonString.slice(Math.max(0, position - 40), Math.min(jsonString.length, position + 40))
    : preview;

  return {
    details: `JSON parse error near: "${context}". ${err.message}`,
    recoverySteps: [
      "Check if response was truncated or incomplete",
      "Verify encoding (UTF-8 expected)",
      "Look for non-JSON content (error HTML page, missing Content-Type header)",
      "Check for unescaped control characters or invalid Unicode",
    ],
  };
}

/**
 * Extract headers from fetch response for debugging.
 */
function extractResponseHeaders(response?: Response): Record<string, string> {
  if (!response || !response.headers) return {};
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });
  return headers;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Error Reporting Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a structured error report from an error and context.
 * Use this in try/catch blocks to standardize error handling.
 */
export function createToolErrorReport(
  err: unknown,
  context: Partial<ToolErrorContext>,
): ToolErrorReport {
  const fullContext: ToolErrorContext = {
    toolName: context.toolName || "unknown",
    operation: context.operation,
    url: context.url,
    params: context.params,
    requestBody: context.requestBody,
    responseBody: context.responseBody,
    httpStatus: context.httpStatus,
    headers: context.headers,
    timestamp: Date.now(),
    duration: context.duration,
  };

  let errorType: ToolErrorType = "unknown_error";
  let message = "";
  let suggestion = "";
  let debugInfo: DebugInfo = { retryable: false };
  let originalError: Error | null = null;

  if (err instanceof TypeError && err.message.includes("fetch")) {
    errorType = "network_error";
    message = `Network error: ${err.message}`;
    suggestion = "Check network connectivity, firewall rules, and API endpoint availability.";
    debugInfo = {
      errorStack: err.stack,
      retryable: true,
      recoverySteps: [
        "Verify network connection",
        "Check firewall/proxy settings",
        "Verify API endpoint is accessible",
      ],
    };
    originalError = err;
  } else if (err instanceof SyntaxError) {
    errorType = "parsing_error";
    message = `Response parsing error: ${err.message}`;
    const parseDetails = analyzeJsonError(fullContext.responseBody || "", err as SyntaxError);
    suggestion = parseDetails.details;
    debugInfo = {
      errorStack: err.stack,
      parseErrorDetails: parseDetails.details,
      retryable: false,
      recoverySteps: parseDetails.recoverySteps,
    };
    originalError = err;
  } else if (fullContext.httpStatus) {
    const httpAnalysis = analyzeHttpError(fullContext.httpStatus, "unknown", fullContext.headers);
    errorType = httpAnalysis.type;
    message = `HTTP ${fullContext.httpStatus} error from ${fullContext.url}`;
    suggestion = httpAnalysis.suggestion;
    debugInfo = {
      httpErrorDetails: `${fullContext.httpStatus}: ${fullContext.responseBody?.slice(0, 200) || "no body"}`,
      retryable: httpAnalysis.retryable,
      rateLimitHeaders: httpAnalysis.rateLimitHeaders,
    };
  } else if (err instanceof Error) {
    message = err.message;
    debugInfo = {
      errorStack: err.stack,
      retryable: err.message.includes("timeout") || err.message.includes("ECONNRESET"),
      recoverySteps: err.message.includes("timeout")
        ? ["Increase timeout duration", "Reduce request payload", "Check server performance"]
        : undefined,
    };
    originalError = err;
  } else {
    message = String(err);
  }

  return {
    type: errorType,
    message,
    context: fullContext,
    suggestion,
    debugInfo,
    originalError,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Logging and Debugging
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Format error report for user-facing error message.
 */
export function formatErrorMessage(report: ToolErrorReport, verbose: boolean = false): string {
  if (!verbose) {
    return report.message;
  }

  const lines: string[] = [
    `❌ ${report.type.toUpperCase()}: ${report.message}`,
    `📍 Tool: ${report.context.toolName}`,
  ];

  if (report.context.operation) lines.push(`   Operation: ${report.context.operation}`);
  if (report.context.url) lines.push(`   URL: ${report.context.url}`);
  if (report.context.httpStatus) lines.push(`   HTTP Status: ${report.context.httpStatus}`);
  if (report.context.duration) lines.push(`   Duration: ${report.context.duration}ms`);

  if (report.suggestion) lines.push(`\n💡 Suggestion: ${report.suggestion}`);

  if (report.debugInfo.recoverySteps && report.debugInfo.recoverySteps.length > 0) {
    lines.push(`\n🔧 Recovery steps:`);
    report.debugInfo.recoverySteps.forEach((step) => lines.push(`   • ${step}`));
  }

  if (report.debugInfo.rateLimitHeaders) {
    lines.push(`\n⏱️  Rate Limit Info:`);
    Object.entries(report.debugInfo.rateLimitHeaders).forEach(([key, val]) => {
      lines.push(`   ${key}: ${val}`);
    });
  }

  if (report.debugInfo.retryable) {
    lines.push(`\n🔄 This error is retryable. Consider implementing exponential backoff.`);
  }

  return lines.join("\n");
}

/**
 * Create structured debug context for troubleshooting future issues.
 */
export function captureDebugContext(
  toolName: string,
  params: Record<string, unknown>,
  response?: Response,
  responseBody?: string,
): ToolErrorContext {
  return {
    toolName,
    params,
    url: response?.url,
    httpStatus: response?.status,
    headers: extractResponseHeaders(response),
    responseBody: responseBody?.slice(0, 2000), // Limit size
    timestamp: Date.now(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation Error Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validate HTTP response for common issues.
 */
export function validateHttpResponse(
  response: Response,
  expectedContentType?: "json" | "xml" | "text",
): { valid: boolean; error?: string } {
  // Check content type
  const contentType = response.headers.get("content-type") || "";

  if (expectedContentType === "json" && !contentType.includes("application/json")) {
    return {
      valid: false,
      error: `Expected JSON response but got: ${contentType}. Response may be error HTML page.`,
    };
  }

  if (expectedContentType === "xml" && !contentType.includes("xml")) {
    return {
      valid: false,
      error: `Expected XML response but got: ${contentType}. Check OAI-PMH endpoint.`,
    };
  }

  // Check for success code
  if (!response.ok) {
    return {
      valid: false,
      error: `HTTP ${response.status} ${response.statusText}`,
    };
  }

  return { valid: true };
}

/**
 * Safe JSON parse with structured error info.
 */
export function safeJsonParse<T>(
  jsonStr: string,
  context?: Partial<ToolErrorContext>,
): { success: boolean; data?: T; error?: ToolErrorReport } {
  try {
    const data = JSON.parse(jsonStr) as T;
    return { success: true, data };
  } catch (err) {
    const report = createToolErrorReport(err, context || {});
    return { success: false, error: report };
  }
}

/**
 * Generate unique error request ID for tracking.
 */
export function generateErrorRequestId(): string {
  return `err_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Format tool error as MCP tool response.
 */
export function formatToolErrorResponse(
  report: ToolErrorReport,
  verbose: boolean = false,
): { content: Array<{ type: "text"; text: string }>; isError: true } {
  const errorId = generateErrorRequestId();
  const message = formatErrorMessage(report, verbose);

  const text = verbose
    ? message
    : `Error calling ${report.context.toolName}: ${report.message} [${errorId}]`;

  return {
    content: [{ type: "text", text }],
    isError: true,
  };
}

/**
 * Lightweight formatter for existing tools that still use local catch blocks.
 * This is intentionally compact so it can be adopted safely across many tools.
 */
export function toToolErrorText(err: unknown, context: Partial<ToolErrorContext> = {}): string {
  const report = createToolErrorReport(err, context);
  return formatErrorMessage(report, false);
}
