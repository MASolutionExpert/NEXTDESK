export type MediaErrorCode =
  | "insecure_context"
  | "permission_denied"
  | "no_device"
  | "device_busy"
  | "media_failed";

export type IceFailureVerdict =
  | "relay_failed"
  | "stun_only"
  | "host_only"
  | "no_candidates";

export interface IceFailureSummary {
  verdict: IceFailureVerdict;
  candidateTypes: string[];
  turnConfigured: boolean;
}

/**
 * Classifies a getUserMedia / media capture failure into a structured code so
 * the call screen can explain the real root cause instead of showing a generic
 * failure or blaming TURN.
 */
export function classifyMediaError(err: any): MediaErrorCode {
  if (
    typeof window !== "undefined" &&
    (window.isSecureContext === false || !navigator?.mediaDevices?.getUserMedia)
  ) {
    return "insecure_context";
  }
  const name = String(err?.name || "");
  const message = String(err?.message || "").toLowerCase();
  if (
    name === "NotAllowedError" ||
    name === "PermissionDeniedError" ||
    name === "SecurityError" ||
    message.includes("permission") ||
    message.includes("denied")
  ) {
    return "permission_denied";
  }
  if (
    name === "NotFoundError" ||
    name === "DevicesNotFoundError" ||
    name === "OverconstrainedError" ||
    message.includes("requested device not found")
  ) {
    return "no_device";
  }
  if (
    name === "NotReadableError" ||
    name === "TrackStartError" ||
    name === "AbortError" ||
    message.includes("in use") ||
    message.includes("could not start")
  ) {
    return "device_busy";
  }
  return "media_failed";
}

/**
 * Returns true if at least one ICE server entry advertises a TURN or TURNS URL.
 */
export function hasTurnConfigured(iceServers: any): boolean {
  if (!Array.isArray(iceServers)) return false;
  for (const server of iceServers) {
    if (!server) continue;
    const rawUrls = server.urls ?? server.url;
    const list = Array.isArray(rawUrls) ? rawUrls : rawUrls ? [rawUrls] : [];
    for (const url of list) {
      if (typeof url === "string" && /^turns?:/i.test(url.trim())) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Pure verdict classifier given deduplicated local ICE candidate types and
 * whether TURN was configured in RTCPeerConnection.
 */
export function classifyIceFailureVerdict(
  candidateTypes: string[],
  turnConfigured: boolean,
): IceFailureVerdict {
  const unique = Array.from(
    new Set(
      (Array.isArray(candidateTypes) ? candidateTypes : [])
        .map((c) => String(c || "").trim().toLowerCase())
        .filter(Boolean),
    ),
  );
  if (unique.length === 0) return "no_candidates";
  if (turnConfigured || unique.includes("relay")) return "relay_failed";
  if (unique.includes("srflx") || unique.includes("prflx")) return "stun_only";
  return "host_only";
}

/**
 * Collects local ICE candidate types from pc.getStats() and returns a concise
 * diagnostic summary for the CallScreen failure banner.
 */
export async function collectIceFailureSummary(
  pc: any,
  iceServers: any = [],
): Promise<IceFailureSummary> {
  const turnConfigured = hasTurnConfigured(iceServers);
  const types = new Set<string>();
  if (pc && typeof pc.getStats === "function") {
    try {
      const stats = await pc.getStats();
      stats.forEach((report: any) => {
        if (report?.type === "local-candidate" && report?.candidateType) {
          types.add(String(report.candidateType).trim().toLowerCase());
        }
      });
    } catch (_) {
      // Ignore stats errors on closed peer connections.
    }
  }
  const candidateTypes = Array.from(types);
  const verdict = classifyIceFailureVerdict(candidateTypes, turnConfigured);
  return { verdict, candidateTypes, turnConfigured };
}

/**
 * Logs ICE candidate pairs and connection state transitions for debugging
 * WebRTC connectivity issues in the browser console.
 */
export async function logIceDiagnostics(pc: any, reason: string) {
  if (!pc || typeof pc.getStats !== "function") return;
  try {
    const stats = await pc.getStats();
    const candidateKinds = new Map<any, any>();
    const pairs: any = [];
    stats.forEach((report: any) => {
      if (
        report.type === "local-candidate" ||
        report.type === "remote-candidate"
      ) {
        candidateKinds.set(
          report.id,
          `${report.candidateType || "?"}/${report.protocol || "?"}`,
        );
      } else if (report.type === "candidate-pair") {
        pairs.push(report);
      }
    });
    const pairLabel = (pair: any) =>
      `${candidateKinds.get(pair.localCandidateId) || "?"} -> ${
        candidateKinds.get(pair.remoteCandidateId) || "?"
      }:${pair.state}${pair.nominated ? " nominated" : ""}`;
    console.warn(
      `[call] ICE ${reason}:`,
      JSON.stringify({
        connection: pc.connectionState,
        ice: pc.iceConnectionState,
        signaling: pc.signalingState,
        pairs: pairs.map(pairLabel),
      }),
    );
  } catch (_) {}
}
