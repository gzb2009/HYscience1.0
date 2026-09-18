import type { SessionStatus } from "@hysci/sdk/v2/client"

/**
 * "Running" means the model is generating or retrying. A session parked on a
 * pending question (`busy/waiting`) is the user's turn, so it must not spin.
 */
export function sessionRunning(status: SessionStatus | undefined) {
  if (!status) return false
  if (status.type === "retry") return true
  return status.type === "busy" && status.phase !== "waiting"
}
