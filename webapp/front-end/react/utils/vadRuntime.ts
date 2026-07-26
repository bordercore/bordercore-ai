export type VadRuntimeState =
  | { status: "off" }
  | { status: "starting" }
  | { status: "ready" }
  | { status: "error"; message: string };

export function describeVadStartupError(error: unknown): string {
  const name = typeof error === "object" && error && "name" in error ? String(error.name) : "";
  const message = error instanceof Error ? error.message : String(error ?? "");

  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return "Microphone permission was denied";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "No microphone was found";
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return "The microphone is unavailable or already in use";
  }
  if (name === "SecurityError") {
    return "Microphone access requires a secure connection";
  }
  if (/\b(?:onnx|wasm|model|asset|fetch|network)\b/iu.test(message)) {
    return "The VAD model could not be loaded";
  }
  return "Voice detection could not be started";
}
