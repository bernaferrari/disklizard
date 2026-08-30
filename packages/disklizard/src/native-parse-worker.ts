import { parentPort, workerData } from "node:worker_threads"
import { isNativeParseWorkerRequest, type NativeParseWorkerMessage } from "./native-parse-worker-contract"
import { runNativeScannerSidecar } from "./native-sidecar-runner"

const controller = new AbortController()
let terminalPosted = false

const post = (message: NativeParseWorkerMessage) => {
  if (terminalPosted) return
  if (message.type !== "progress") terminalPosted = true
  parentPort?.postMessage(message)
}

const onCommand = (value: unknown) => {
  if (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    (value as { type?: unknown }).type === "cancel"
  ) {
    controller.abort(new Error("Scan cancelled"))
  }
}

parentPort?.on("message", onCommand)

try {
  if (!isNativeParseWorkerRequest(workerData)) throw new Error("Invalid native parse worker request")
  const request = workerData
  const root = await runNativeScannerSidecar(request, {
    signal: controller.signal,
    onProgress: (progress) => post({ type: "progress", progress }),
  })
  post({ type: "done", root })
} catch (error) {
  post({
    type: "error",
    message: error instanceof Error ? error.message : String(error),
  })
} finally {
  parentPort?.off("message", onCommand)
}
