type TelemetryPayload = Record<string, unknown>;

export function init() {}
export function addBreadcrumb(_payload: TelemetryPayload) {}
export function captureMessage(_message: string, _payload?: TelemetryPayload) {}
export function captureException(_error: unknown, _payload?: TelemetryPayload) {}
export function consoleLoggingIntegration() { return null; }
export function breadcrumbsIntegration() { return null; }
