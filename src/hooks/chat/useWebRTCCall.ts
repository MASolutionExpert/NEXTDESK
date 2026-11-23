'use client';

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchIceServers, fetchIncomingCall, sendCallSignal } from "../../api/chatApi.ts";
import {
  isCallSupported,
  isScreenShareSupported,
  foldIncomingRemoteStream,
} from "../../utils/callCapabilities.ts";
import {
  classifyMediaError,
  collectIceFailureSummary,
  logIceDiagnostics,
} from "../../utils/iceDiagnostics.ts";

/**
 * Grade connection quality from WebRTC stats into signal bars.
 * Returns 0 (unknown, no stats yet) through 4 (excellent).
 * When both metrics are present the worse one wins.
 */
export function gradeCallQuality(rttMs, lossPct) {
  const grades: any = [];
  if (Number.isFinite(rttMs)) {
    grades.push(rttMs < 100 ? 4 : rttMs < 200 ? 3 : rttMs < 400 ? 2 : 1);
  }
  if (Number.isFinite(lossPct)) {
    grades.push(lossPct < 1 ? 4 : lossPct < 3 ? 3 : lossPct < 8 ? 2 : 1);
  }
  if (grades.length === 0) return 0;
  return Math.min(...grades);
}

const UNKNOWN_QUALITY = { level: 0, rttMs: null, packetLossPct: null };
export const CALL_END_NOTICE_MS = 1750;
export const CALL_FAILURE_DETAIL_NOTICE_MS = 4500;
export const CALL_EXIT_MS = 250;
export const ICE_RESTART_RECOVERY_MS = 10000;

/**
 * Capture the local media stream for a call. A video request fails on
 * camera-less devices (NotFoundError) or when the camera is otherwise
 * unusable; fall back to an audio-only call.
 */
export async function acquireLocalMedia(wantsVideo) {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: wantsVideo,
    });
    return { stream, hasVideo: wantsVideo };
  } catch (err) {
    if (!wantsVideo) throw err;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    return { stream, hasVideo: false };
  }
}

/**
 * Put an outgoing video track on the peer connection. An existing video
 * sender (the camera, or a sender left over from an earlier share) is reused
 * with replaceTrack so no renegotiation is needed. Otherwise the video
 * transceiver negotiated at call setup is switched to sending, or a new
 * track is added. Returns { sender, needsNegotiation }.
 */
export async function attachOutgoingVideoTrack(pc, track, stream) {
  const senders = typeof pc.getSenders === "function" ? pc.getSenders() : [];
  const activeSender = senders.find((s) => s.track?.kind === "video");
  if (activeSender) {
    await activeSender.replaceTrack(track);
    return { sender: activeSender, needsNegotiation: false };
  }

  const transceivers =
    typeof pc.getTransceivers === "function" ? pc.getTransceivers() : [];
  const videoTransceiver = transceivers.find(
    (t) =>
      !t.stopped &&
      t.currentDirection !== "stopped" &&
      t.receiver?.track?.kind === "video",
  );
  if (videoTransceiver) {
    await videoTransceiver.sender.replaceTrack(track);
    if (stream && typeof videoTransceiver.sender.setStreams === "function") {
      videoTransceiver.sender.setStreams(stream);
    }
    const direction = videoTransceiver.direction;
    if (direction === "sendrecv" || direction === "sendonly") {
      return { sender: videoTransceiver.sender, needsNegotiation: false };
    }
    videoTransceiver.direction =
      direction === "inactive" ? "sendonly" : "sendrecv";
    return { sender: videoTransceiver.sender, needsNegotiation: true };
  }

  const sender = stream ? pc.addTrack(track, stream) : pc.addTrack(track);
  return { sender, needsNegotiation: true };
}

/**
 * Attach a freshly acquired camera track: add it to the local preview stream,
 * retarget the video sender (no renegotiation when one exists). The caller
 * has already stopped and removed the outgoing camera — iOS Safari cannot
 * hold two captures at once, so the stream may have no video track here.
 * Do not reassign srcObject when the element already plays this stream: iOS
 * Safari reloads the element on reassignment, which resets object-fit and
 * re-introduces the letterbox gap in the PiP box. Track swaps render live.
 */
export async function swapCameraTrack({ pc, stream, newTrack, videoEl }: any) {
  stream.addTrack(newTrack);
  if (videoEl && videoEl.srcObject !== stream) videoEl.srcObject = stream;
  try {
    return await attachOutgoingVideoTrack(pc, newTrack, stream);
  } catch (err) {
    // The sender still carries the stopped previous camera, so the stream
    // must not advertise a track it is not sending.
    try {
      stream.removeTrack(newTrack);
    } catch (_) {}
    if (videoEl && videoEl.srcObject !== stream) videoEl.srcObject = stream;
    try {
      newTrack.stop();
    } catch (_) {}
    throw err;
  }
}

/**
 * True when a local send was left out of the last negotiation, which happens
 * when an offer collision rolled back the offer that carried it.
 */
export function hasUnnegotiatedSend(pc) {
  const transceivers =
    typeof pc.getTransceivers === "function" ? pc.getTransceivers() : [];
  return transceivers.some((t) => {
    if (t.stopped || t.currentDirection === "stopped") return false;
    if (!t.direction?.includes("send")) return false;
    return !t.mid || !t.currentDirection?.includes("send");
  });
}

/**
 * Call states: idle | calling | ringing | connected
 */
export function useWebRTCCall({ realtimeSenderRef }: any = {}) {
  const [callState, setCallState] = useState("idle");
  // Set while the call is winding down so the screen can show why it ended
  // (declined | busy | missed | peer_media_failed | ended | failed) before dropping out.
  const [callEndReason, setCallEndReason] = useState<any>(null);
  const [callFailureDetail, setCallFailureDetail] = useState<any>(null);
  const [isCallClosing, setIsCallClosing] = useState(false);
  const [callType, setCallType] = useState("voice"); // voice | video
  const [callChatId, setCallChatId] = useState<any>(null);
  const [callPeer, setCallPeer] = useState<any>(null); // { username, nickname, avatar }
  const [callDuration, setCallDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  // True when the local device has no usable camera.
  const [isCameraUnavailable, setIsCameraUnavailable] = useState(false);
  const [isRemoteCameraOff, setIsRemoteCameraOff] = useState(true);
  const [isSpeakerOn, setIsSpeakerOn] = useState(true);
  const [remoteStreamTick, setRemoteStreamTick] = useState(0);
  const [callQuality, setCallQuality] = useState(UNKNOWN_QUALITY);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isRemoteScreenSharing, setIsRemoteScreenSharing] = useState(false);
  const [isScreenAudioMuted, setIsScreenAudioMuted] = useState(false);
  // True when the local device exposes more than one camera (front/back flip).
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false);

  const peerConnectionRef = useRef<any>(null);
  const localStreamRef = useRef<any>(null);
  const remoteStreamRef = useRef<any>(null);
  const localVideoRef = useRef<any>(null);
  const remoteVideoRef = useRef<any>(null);
  const remoteAudioRef = useRef<any>(null);
  const screenAudioRef = useRef<any>(null);
  const screenAudioStreamRef = useRef<any>(null);
  const durationTimerRef = useRef<any>(null);
  const disconnectTimerRef = useRef<any>(null);
  const iceRestartTimerRef = useRef<any>(null);
  const iceRestartAttemptedRef = useRef(false);
  const endNoticeTimerRef = useRef<any>(null);
  const endExitTimerRef = useRef<any>(null);
  const callEndReasonRef = useRef<any>(null);
  const iceServersRef = useRef<any>([]);
  const pendingCandidatesRef = useRef<any>([]);
  // Active screen capture track, and the RTP sender carrying outgoing video
  // (camera or screen) so the two can be swapped without renegotiating.
  const screenTrackRef = useRef<any>(null);
  const screenAudioSenderRef = useRef<any>(null);
  const videoSenderRef = useRef<any>(null);
  // Current capture facing ("user" | "environment") and in-flight flip guard,
  // plus a ref mirror of the multi-camera check used inside stable callbacks.
  const facingModeRef = useRef("user");
  const isFlippingRef = useRef(false);
  const hasMultipleCamerasRef = useRef(false);
  // Offer collisions: both peers may renegotiate at once. The callee is the
  // polite peer and yields; the caller ignores the colliding offer.
  const isPolitePeerRef = useRef(false);
  const isMakingOfferRef = useRef(false);
  const isSettingRemoteAnswerRef = useRef(false);

  // Mirrors of state used inside stable callbacks so they never read stale values
  const callStateRef = useRef(callState);
  const callTypeRef = useRef(callType);
  const callChatIdRef = useRef(callChatId);
  const cameraUnavailableRef = useRef(false);

  useEffect(() => {
    cameraUnavailableRef.current = isCameraUnavailable;
  }, [isCameraUnavailable]);

  useEffect(() => {
    hasMultipleCamerasRef.current = hasMultipleCameras;
  }, [hasMultipleCameras]);

  // Count cameras once permission exists (a connected call has granted it);
  // labels are only reliable after getUserMedia. Re-run when the camera turns
  // on: iOS Safari lists no video devices before camera permission is
  // granted, and a voice call may grant it mid-call (camera opened later).
  useEffect(() => {
    if (callState !== "connected") return undefined;
    let isCancelled = false;
    navigator.mediaDevices
      ?.enumerateDevices?.()
      .then((devices) => {
        if (!isCancelled) {
          setHasMultipleCameras(
            devices.filter((d) => d.kind === "videoinput").length > 1,
          );
        }
      })
      .catch(() => {});
    return () => {
      isCancelled = true;
    };
  }, [callState, isCameraOff]);

  useEffect(() => {
    callStateRef.current = callState;
  }, [callState]);

  useEffect(() => {
    callTypeRef.current = callType;
  }, [callType]);

  useEffect(() => {
    callChatIdRef.current = callChatId;
  }, [callChatId]);

  // Outgoing signal sender: prefers WebSocket if open, falls back to POST /api/calls/:action
  const postSignal = useCallback(
    async (path, body: any = {}) => {
      if (realtimeSenderRef?.current) {
        try {
          const sent = realtimeSenderRef.current({
            action: "call_signal",
            signalType: path,
            chatId: body.chatId,
            data: body,
          });
          if (sent) return { ok: true };
        } catch (_) {}
      }
      return await sendCallSignal(path, body);
    },
    [realtimeSenderRef]
  );

  // Fetch ICE servers once on mount
  useEffect(() => {
    let isCancelled = false;
    void fetchIceServers().then((servers) => {
      if (!isCancelled && Array.isArray(servers) && servers.length) {
        iceServersRef.current = servers;
      }
    });
    return () => {
      isCancelled = true;
    };
  }, []);

  // Re-fetch ICE servers per call: the server config and credentials can
  // change while the app stays open. The cached list is only a fallback for
  // when the re-fetch fails or comes back empty.
  const ensureIceServers = useCallback(async () => {
    const servers = await fetchIceServers();
    if (Array.isArray(servers) && servers.length) {
      iceServersRef.current = servers;
    }
    return iceServersRef.current;
  }, []);

  const clearEndTimers = useCallback(() => {
    if (endNoticeTimerRef.current) {
      clearTimeout(endNoticeTimerRef.current);
      endNoticeTimerRef.current = null;
    }
    if (endExitTimerRef.current) {
      clearTimeout(endExitTimerRef.current);
      endExitTimerRef.current = null;
    }
  }, []);

  const releaseScreenShare = useCallback(() => {
    const track = screenTrackRef.current;
    screenTrackRef.current = null;
    if (track) {
      track.onended = null;
      try {
        track.stop();
      } catch (_) {}
    }
    videoSenderRef.current = null;
  }, []);

  const resetCallState = useCallback(() => {
    if (durationTimerRef.current) {
      clearInterval(durationTimerRef.current);
      durationTimerRef.current = null;
    }
    if (disconnectTimerRef.current) {
      clearTimeout(disconnectTimerRef.current);
      disconnectTimerRef.current = null;
    }
    if (iceRestartTimerRef.current) {
      clearTimeout(iceRestartTimerRef.current);
      iceRestartTimerRef.current = null;
    }
    iceRestartAttemptedRef.current = false;
    clearEndTimers();
    callEndReasonRef.current = null;
    setCallEndReason(null);
    setCallFailureDetail(null);

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }

    if (remoteStreamRef.current) {
      remoteStreamRef.current.getTracks().forEach((t) => t.stop());
      remoteStreamRef.current = null;
    }
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null;
      remoteAudioRef.current.muted = false;
    }
    if (remoteVideoRef.current) {
      remoteVideoRef.current.muted = false;
    }
    screenAudioStreamRef.current = null;
    if (screenAudioRef.current) {
      screenAudioRef.current.srcObject = null;
      screenAudioRef.current.muted = false;
    }

    if (peerConnectionRef.current) {
      try {
        peerConnectionRef.current.close();
      } catch (_) {}
      peerConnectionRef.current = null;
    }

    pendingCandidatesRef.current = [];
    isPolitePeerRef.current = false;
    isMakingOfferRef.current = false;
    isSettingRemoteAnswerRef.current = false;
    releaseScreenShare();
    setIsScreenSharing(false);
    setIsRemoteScreenSharing(false);
    cameraUnavailableRef.current = false;
    setCallQuality(UNKNOWN_QUALITY);
    setCallState("idle");
    callStateRef.current = "idle";
    setCallChatId(null);
    callChatIdRef.current = null;
    setCallPeer(null);
    setCallDuration(0);
    setIsMuted(false);
    setIsCameraOff(false);
    setIsCameraUnavailable(false);
    setIsRemoteCameraOff(true);
    setIsSpeakerOn(true);
    setIsScreenAudioMuted(false);
    setHasMultipleCameras(false);
    facingModeRef.current = "user";
    setIsCallClosing(false);
  }, [clearEndTimers, releaseScreenShare]);

  // Fade the call screen out, then clear all call state.
  const beginCallExit = useCallback(() => {
    if (endExitTimerRef.current) return;
    if (endNoticeTimerRef.current) {
      clearTimeout(endNoticeTimerRef.current);
      endNoticeTimerRef.current = null;
    }
    setIsCallClosing(true);
    endExitTimerRef.current = setTimeout(resetCallState, CALL_EXIT_MS);
  }, [resetCallState]);

  // Show why the call ended for a few seconds before the screen goes away.
  const finishCall = useCallback(
    (reason, detail: any = null) => {
      if (
        callStateRef.current === "idle" ||
        callEndReasonRef.current ||
        endExitTimerRef.current
      )
        return;
      callEndReasonRef.current = reason;
      setCallEndReason(reason);
      setCallFailureDetail(detail);
      if (durationTimerRef.current) {
        clearInterval(durationTimerRef.current);
        durationTimerRef.current = null;
      }
      if (disconnectTimerRef.current) {
        clearTimeout(disconnectTimerRef.current);
        disconnectTimerRef.current = null;
      }
      if (iceRestartTimerRef.current) {
        clearTimeout(iceRestartTimerRef.current);
        iceRestartTimerRef.current = null;
      }
      iceRestartAttemptedRef.current = false;
      // Stop capturing immediately; the notice is purely visual.
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
        localStreamRef.current = null;
      }
      releaseScreenShare();
      setIsScreenSharing(false);
      setIsRemoteScreenSharing(false);
      if (remoteAudioRef.current) remoteAudioRef.current.muted = true;
      if (remoteVideoRef.current) remoteVideoRef.current.muted = true;
      if (peerConnectionRef.current) {
        try {
          peerConnectionRef.current.close();
        } catch (_) {}
        peerConnectionRef.current = null;
      }
      const noticeMs =
        detail && detail.kind !== "rejected"
          ? CALL_FAILURE_DETAIL_NOTICE_MS
          : CALL_END_NOTICE_MS;
      endNoticeTimerRef.current = setTimeout(beginCallExit, noticeMs);
    },
    [beginCallExit, releaseScreenShare],
  );

  // Media path broke locally: tell the peer/server the call is over too.
  const failCall = useCallback(
    (detail: any = null) => {
      const chatId = callChatIdRef.current;
      finishCall("failed", detail);
      if (chatId) void postSignal("end", { chatId, reason: "failed" });
    },
    [finishCall, postSignal],
  );

  const createPeerConnection = useCallback(async () => {
    const iceServers = await ensureIceServers();
    if (!iceServers.length) {
      // Diagnoses the cached-IceServers bug: this PC gets no STUN/TURN at all.
      console.warn("[call] creating peer connection with no ICE servers");
    }
    const pc = new RTCPeerConnection({ iceServers });

    pc.onicecandidate = (event) => {
      if (event.candidate && callChatIdRef.current) {
        void postSignal("ice-candidate", {
          chatId: callChatIdRef.current,
          candidate: event.candidate.toJSON ? event.candidate.toJSON() : event.candidate,
        });
      }
    };

    pc.ontrack = (event) => {
      // Screen-share audio arrives on its own display stream; route it to a
      // dedicated element so it can be muted independently from the mic.
      const ownStream = event.streams?.[0];
      if (
        event.track?.kind === "audio" &&
        ownStream &&
        remoteStreamRef.current &&
        ownStream !== remoteStreamRef.current
      ) {
        screenAudioStreamRef.current = ownStream;
        if (screenAudioRef.current) {
          screenAudioRef.current.srcObject = ownStream;
          screenAudioRef.current.play?.().catch(() => {});
        }
        setRemoteStreamTick((t) => t + 1);
        return;
      }
      // A video sender reused for screen sharing may arrive without a stream
      // association; fold its track into the current remote stream.
      const stream = foldIncomingRemoteStream(event, remoteStreamRef.current);
      remoteStreamRef.current = stream;
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = stream;
      }
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = stream;
        remoteAudioRef.current.play?.().catch(() => {});
      }
      setRemoteStreamTick((t) => t + 1);
    };

    const failWithIceSummary = (targetPc: any) => {
      void collectIceFailureSummary(targetPc, iceServersRef.current).then(
        (summary) => {
          failCall({ kind: "ice", ...summary });
        },
        () => {
          failCall({ kind: "ice", verdict: "no_candidates", candidateTypes: [], turnConfigured: false });
        },
      );
    };

    const attemptIceRestart = (targetPc: any) => {
      if (
        iceRestartAttemptedRef.current ||
        !targetPc ||
        targetPc.signalingState === "closed"
      ) {
        return false;
      }
      iceRestartAttemptedRef.current = true;
      try {
        if (typeof targetPc.restartIce === "function") {
          targetPc.restartIce();
        }
      } catch (_) {}
      // Caller (impolite peer) initiates the ICE-restart offer; both sides wait
      // up to ICE_RESTART_RECOVERY_MS before declaring the call failed.
      if (!isPolitePeerRef.current && callChatIdRef.current) {
        void (async () => {
          try {
            const offer = await targetPc.createOffer({ iceRestart: true });
            await targetPc.setLocalDescription(offer);
            if (targetPc.signalingState === "have-local-offer") {
              await postSignal("offer", {
                chatId: callChatIdRef.current,
                sdp: offer,
              });
            }
          } catch (_) {}
        })();
      }
      if (iceRestartTimerRef.current) {
        clearTimeout(iceRestartTimerRef.current);
      }
      iceRestartTimerRef.current = setTimeout(() => {
        iceRestartTimerRef.current = null;
        if (
          peerConnectionRef.current === targetPc &&
          targetPc.connectionState !== "connected"
        ) {
          failWithIceSummary(targetPc);
        }
      }, ICE_RESTART_RECOVERY_MS);
      return true;
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") {
        if (disconnectTimerRef.current) {
          clearTimeout(disconnectTimerRef.current);
          disconnectTimerRef.current = null;
        }
        if (iceRestartTimerRef.current) {
          clearTimeout(iceRestartTimerRef.current);
          iceRestartTimerRef.current = null;
        }
        iceRestartAttemptedRef.current = false;
        setCallState("connected");
        callStateRef.current = "connected";
        if (!durationTimerRef.current) {
          durationTimerRef.current = setInterval(() => {
            setCallDuration((prev) => prev + 1);
          }, 1000);
        }
      }
      if (pc.connectionState === "disconnected") {
        // Transient ICE blips are common; attempt 1 automatic ICE restart with
        // a 10s recovery window before giving up.
        void logIceDiagnostics(pc, "disconnected");
        if (attemptIceRestart(pc)) return;
        if (!disconnectTimerRef.current) {
          disconnectTimerRef.current = setTimeout(() => {
            disconnectTimerRef.current = null;
            failWithIceSummary(pc);
          }, 5000);
        }
      }
      if (pc.connectionState === "failed") {
        void logIceDiagnostics(pc, "failed");
        if (callStateRef.current === "connected" && attemptIceRestart(pc)) {
          return;
        }
        failWithIceSummary(pc);
      }
      if (pc.connectionState === "closed") {
        failCall();
      }
    };

    peerConnectionRef.current = pc;
    return pc;
  }, [postSignal, failCall, ensureIceServers]);

  const sendOffer = useCallback(
    async (pc, options?: any) => {
      isMakingOfferRef.current = true;
      try {
        const offer = options ? await pc.createOffer(options) : await pc.createOffer();
        await pc.setLocalDescription(offer);
        // A colliding remote offer may have rolled this one back already.
        if (pc.signalingState !== "have-local-offer") return;
        const res = await postSignal("offer", {
          chatId: callChatIdRef.current,
          sdp: offer,
        });
        if (!res || res.ok === false) {
          finishCall("failed", {
            kind: "signaling",
            code: res?.code || "offer_failed",
            message: res?.error,
          });
        }
      } finally {
        isMakingOfferRef.current = false;
      }
    },
    [postSignal, finishCall],
  );

  // Start a call (caller)
  const startCall = useCallback(
    async ({
      chatId,
      calleeUsername,
      calleeNickname,
      calleeAvatar,
      calleeColor,
      calleeVerified,
      calleeRole,
      type = "voice",
    }: any) => {
      const normalizedChatId = String(chatId || "").trim();
      if (!normalizedChatId || !calleeUsername) return;
      if (callStateRef.current !== "idle") return;
      clearEndTimers();
      callEndReasonRef.current = null;
      setCallEndReason(null);
      setCallFailureDetail(null);
      setIsCallClosing(false);

      if (!isCallSupported()) {
        console.warn("Calls are only supported over secure HTTPS connections");
        setCallType(type);
        callTypeRef.current = type;
        setCallChatId(normalizedChatId);
        callChatIdRef.current = normalizedChatId;
        setCallPeer({
          username: calleeUsername,
          nickname: calleeNickname,
          avatar: calleeAvatar,
          color: calleeColor,
          verified: calleeVerified,
          role: calleeRole,
        });
        setCallState("calling");
        callStateRef.current = "calling";
        finishCall("failed", {
          kind: "unsupported",
          code: "insecure_context",
        });
        return;
      }
      isPolitePeerRef.current = false;
      setCallState("calling");
      callStateRef.current = "calling";
      setCallType(type);
      callTypeRef.current = type;
      // Voice calls start with camera off, video calls with camera on.
      setIsCameraOff(type !== "video");
      setIsRemoteCameraOff(type !== "video");
      setCallChatId(normalizedChatId);
      callChatIdRef.current = normalizedChatId;
      setCallPeer({
        username: calleeUsername,
        nickname: calleeNickname,
        avatar: calleeAvatar,
        color: calleeColor,
        verified: calleeVerified,
        role: calleeRole,
      });

      try {
        const { stream: gotStream, hasVideo } = await acquireLocalMedia(
          type === "video",
        );
        localStreamRef.current = gotStream;
        // A video call started on a device without a usable camera joins
        // audio-only with the camera off.
        setIsCameraOff(!hasVideo);
        setIsCameraUnavailable(type === "video" && !hasVideo);
        if (localVideoRef.current && hasVideo) {
          localVideoRef.current.srcObject = gotStream;
        }

        const res = await postSignal("start", {
          chatId: normalizedChatId,
          type,
        });
        if (!res || (res.ok === false && !res.call)) {
          if (res?.code === "callee_busy" || res?.status === 409) {
            finishCall("busy", {
              kind: "server",
              code: "callee_busy",
              message: res?.error,
            });
          } else {
            finishCall("failed", {
              kind: "server",
              code: res?.code || "start_failed",
              message: res?.error,
            });
          }
        } else if (type === "video" && !hasVideo) {
          // A camera-less video caller joins audio-only.
          void postSignal("camera-state", {
            chatId: normalizedChatId,
            cameraOff: true,
          });
        }
      } catch (err: any) {
        console.error("Failed to start call:", err);
        finishCall("failed", {
          kind: "media",
          code: classifyMediaError(err),
          message: err?.message,
        });
      }
    },
    [postSignal, finishCall, clearEndTimers]
  );

  // Associate media streams with the media elements once they mount or when a
  // new remote stream arrives.
  useEffect(() => {
    if (callState !== "connected") return;
    if (localVideoRef.current && localStreamRef.current) {
      localVideoRef.current.srcObject = localStreamRef.current;
    }
    if (remoteVideoRef.current && remoteStreamRef.current) {
      remoteVideoRef.current.srcObject = remoteStreamRef.current;
    }
    if (remoteAudioRef.current && remoteStreamRef.current) {
      remoteAudioRef.current.srcObject = remoteStreamRef.current;
      remoteAudioRef.current.play?.().catch(() => {});
    }
    if (screenAudioRef.current && screenAudioStreamRef.current) {
      screenAudioRef.current.srcObject = screenAudioStreamRef.current;
      screenAudioRef.current.play?.().catch(() => {});
    }
  }, [callState, callType, remoteStreamTick]);

  // Speaker toggle flips mute on the remote media elements.
  useEffect(() => {
    if (remoteVideoRef.current) {
      remoteVideoRef.current.muted = !isSpeakerOn;
    }
    if (remoteAudioRef.current) {
      remoteAudioRef.current.muted = !isSpeakerOn;
    }
    if (screenAudioRef.current) {
      screenAudioRef.current.muted = !isSpeakerOn || isScreenAudioMuted;
    }
  }, [isSpeakerOn, isScreenAudioMuted, callState, callType, remoteStreamTick]);

  // Sample WebRTC stats while connected to derive signal bars from
  // round-trip time (ping) and packet loss. Resets when the call ends.
  useEffect(() => {
    if (callState !== "connected") return undefined;
    let cancelled = false;
    const sample = async () => {
      const pc = peerConnectionRef.current;
      if (!pc || typeof pc.getStats !== "function") return;
      try {
        const stats = await pc.getStats();
        let rttMs: any = null;
        let fallbackRttMs: any = null;
        let lost = 0;
        let received = 0;
        stats.forEach((report) => {
          if (
            report.type === "candidate-pair" &&
            typeof report.currentRoundTripTime === "number"
          ) {
            const ms = report.currentRoundTripTime * 1000;
            if (report.nominated) {
              rttMs = ms;
            } else if (report.state === "succeeded" && fallbackRttMs == null) {
              fallbackRttMs = ms;
            }
          }
          if (report.type === "inbound-rtp" && report.isRemote !== true) {
            if (typeof report.packetsLost === "number") lost += report.packetsLost;
            if (typeof report.packetsReceived === "number")
              received += report.packetsReceived;
          }
        });
        if (rttMs == null) rttMs = fallbackRttMs;
        const total = lost + received;
        const packetLossPct = total > 0 ? (lost / total) * 100 : null;
        if (!cancelled) {
          setCallQuality({
            level: gradeCallQuality(rttMs, packetLossPct),
            rttMs,
            packetLossPct,
          });
        }
      } catch (_) {}
    };
    void sample();
    const interval = setInterval(sample, 2500);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [callState]);

  // Accept incoming call (callee)
  const acceptCall = useCallback(async () => {
    const chatId = callChatIdRef.current;
    if (!chatId) return;

    try {
      const acceptedType = callTypeRef.current;
      const { stream, hasVideo } = await acquireLocalMedia(
        acceptedType === "video",
      );
      localStreamRef.current = stream;
      // Voice calls start with camera off; a video call without a usable
      // camera joins audio-only with the camera off.
      setIsCameraOff(!hasVideo);
      setIsCameraUnavailable(acceptedType === "video" && !hasVideo);

      const pc = await createPeerConnection();
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      // Process queued candidates
      while (pendingCandidatesRef.current.length > 0) {
        const cand = pendingCandidatesRef.current.shift();
        try {
          await pc.addIceCandidate(new RTCIceCandidate(cand));
        } catch (_) {}
      }

      const res = await postSignal("accept", { chatId });
      if (!res || res.ok === false) {
        finishCall("failed", {
          kind: "server",
          code: res?.code || "accept_failed",
          message: res?.error,
        });
        return;
      }
      if (acceptedType === "video" && !hasVideo) {
        // A video call accepted without a usable camera joins audio-only;
        // tell the caller so its screen drops the empty video stage.
        void postSignal("camera-state", { chatId, cameraOff: true });
      }

      // Move out of "ringing" immediately.
      setCallState("connected");
      callStateRef.current = "connected";
      if (!durationTimerRef.current) {
        durationTimerRef.current = setInterval(() => {
          setCallDuration((prev) => prev + 1);
        }, 1000);
      }
    } catch (err: any) {
      console.error("Failed to accept call:", err);
      finishCall("failed", {
        kind: "media",
        code: classifyMediaError(err),
        message: err?.message,
      });
      await postSignal("reject", { chatId, reason: "peer_media_failed" });
    }
  }, [createPeerConnection, postSignal, finishCall]);

  // Reject incoming call (callee)
  const rejectCall = useCallback(async () => {
    const chatId = callChatIdRef.current;
    beginCallExit();
    if (chatId) await postSignal("reject", { chatId });
  }, [postSignal, beginCallExit]);

  // End active call
  const endCall = useCallback(async () => {
    const chatId = callChatIdRef.current;
    beginCallExit();
    if (chatId) await postSignal("end", { chatId });
  }, [postSignal, beginCallExit]);

  const toggleMute = useCallback(() => {
    if (!localStreamRef.current) return;
    localStreamRef.current.getAudioTracks().forEach((track) => {
      track.enabled = !track.enabled;
    });
    setIsMuted((prev) => !prev);
  }, []);

  // Speaker toggle: browsers have no earpiece route, so this controls whether
  // the remote peer is audible through the remote media elements.
  const toggleSpeaker = useCallback(() => {
    setIsSpeakerOn((prev) => !prev);
  }, []);

  // Mute only the shared-screen audio, not the peer's voice.
  const toggleScreenAudio = useCallback(() => {
    setIsScreenAudioMuted((prev) => !prev);
  }, []);

  const toggleCamera = useCallback(async () => {
    if (isFlippingRef.current) return;
    const stream = localStreamRef.current;
    if (!stream) return;
    const videoTracks = stream.getVideoTracks();
    if (videoTracks.length === 0) {
      if (cameraUnavailableRef.current) return;
      try {
        const videoStream = await navigator.mediaDevices.getUserMedia({
          video: true,
        });
        const [videoTrack] = videoStream.getVideoTracks();
        if (!videoTrack) return;
        stream.addTrack(videoTrack);
        const pc = peerConnectionRef.current;
        if (screenTrackRef.current) {
          // The screen is on the video sender; the camera takes over when
          // sharing stops.
        } else if (videoSenderRef.current && pc && pc.signalingState !== "closed") {
          // Reuse the sender an earlier screen share already negotiated.
          await videoSenderRef.current.replaceTrack(videoTrack);
        } else if (pc && pc.signalingState !== "closed") {
          pc.addTrack(videoTrack, stream);
          await sendOffer(pc);
        }
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }
        setCallType("video");
        callTypeRef.current = "video";
        setIsCameraOff(false);
        void postSignal("camera-state", {
          chatId: callChatIdRef.current,
          cameraOff: false,
        });
      } catch (err) {
        console.error("Failed to enable camera:", err);
      }
      return;
    }
    const nextOff = videoTracks.every((track) => track.enabled);
    videoTracks.forEach((track) => {
      track.enabled = !track.enabled;
    });
    setIsCameraOff(nextOff);
    if (nextOff === false) {
      setCallType("video");
      callTypeRef.current = "video";
    }
    void postSignal("camera-state", {
      chatId: callChatIdRef.current,
      cameraOff: nextOff,
    });
  }, [postSignal, sendOffer]);

  // Swap between front and back cameras mid-call: free the outgoing camera,
  // acquire the other one, and hand it to the existing video sender (no
  // renegotiation).
  const flipCamera = useCallback(async () => {
    if (isFlippingRef.current || !hasMultipleCamerasRef.current) return;
    // The video sender carries the screen while sharing; do not swap it.
    if (screenTrackRef.current) return;
    const stream = localStreamRef.current;
    const pc = peerConnectionRef.current;
    if (!stream || !pc || pc.signalingState === "closed") return;
    const [oldTrack] = stream.getVideoTracks();
    if (!oldTrack || !oldTrack.enabled) return;

    const previousFacing = facingModeRef.current;
    const next = previousFacing === "environment" ? "user" : "environment";
    isFlippingRef.current = true;
    try {
      oldTrack.stop();
      stream.removeTrack(oldTrack);
      let newTrack: any = null;
      let flipped = false;
      try {
        const videoStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: next },
        });
        [newTrack] = videoStream.getVideoTracks();
        flipped = Boolean(newTrack);
      } catch (err) {
        console.warn("Failed to switch camera:", err);
      }
      if (!newTrack) {
        // The other camera could not be opened: fall back to the previous
        // one so the sender keeps a live picture instead of a dead one.
        try {
          const fallbackStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: previousFacing },
          });
          [newTrack] = fallbackStream.getVideoTracks();
        } catch (err) {
          console.warn("Failed to switch camera:", err);
        }
        if (!newTrack) {
          // Camera is gone entirely: mirror the camera-off state for the peer.
          if (localStreamRef.current === stream && peerConnectionRef.current === pc) {
            setIsCameraOff(true);
            void postSignal("camera-state", {
              chatId: callChatIdRef.current,
              cameraOff: true,
            });
          }
          return;
        }
      }
      // The call may have ended while the camera was acquired.
      if (localStreamRef.current !== stream || peerConnectionRef.current !== pc) {
        newTrack.stop();
        return;
      }
      if (screenTrackRef.current) {
        // A screen share claimed the video sender mid-flip: the camera waits
        // in the stream; stopScreenShare hands the sender back to it.
        stream.addTrack(newTrack);
        if (
          localVideoRef.current &&
          localVideoRef.current.srcObject !== stream
        ) {
          localVideoRef.current.srcObject = stream;
        }
        if (flipped) facingModeRef.current = next;
        return;
      }
      try {
        const { sender, needsNegotiation } = await swapCameraTrack({
          pc,
          stream,
          newTrack,
          videoEl: localVideoRef.current,
        });
        if (sender) videoSenderRef.current = sender;
        if (flipped) facingModeRef.current = next;
        if (needsNegotiation && peerConnectionRef.current === pc) {
          await sendOffer(pc);
        }
      } catch (err) {
        console.warn("Failed to switch camera:", err);
      }
    } finally {
      isFlippingRef.current = false;
    }
  }, [sendOffer, postSignal]);

  const stopScreenShare = useCallback(async () => {
    const track = screenTrackRef.current;
    if (!track) return;
    const audioTrack = screenAudioSenderRef.current?.track;
    const sender = videoSenderRef.current;
    screenTrackRef.current = null;
    track.onended = null;
    try {
      track.stop();
    } catch (_) {}
    try {
      audioTrack?.stop();
    } catch (_) {}
    setIsScreenSharing(false);
    const pc = peerConnectionRef.current;
    if (sender && pc && pc.signalingState !== "closed") {
      // Hand the video sender back to the camera (or send nothing).
      const cameraTrack = localStreamRef.current?.getVideoTracks()[0] || null;
      try {
        await sender.replaceTrack(cameraTrack);
      } catch (err) {
        console.error("Failed to restore camera after screen share:", err);
      }
    }
    if (callChatIdRef.current) {
      void postSignal("screen-share-state", {
        chatId: callChatIdRef.current,
        sharing: false,
      });
    }
  }, [postSignal]);

  const startScreenShare = useCallback(async () => {
    if (screenTrackRef.current) return;
    if (callStateRef.current !== "connected") return;
    if (!isScreenShareSupported()) return;
    const pc = peerConnectionRef.current;
    if (!pc || pc.signalingState === "closed") return;

    let displayStream;
    try {
      displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });
    } catch (err) {
      // NotAllowedError: the user closed the picker; nothing to report.
      if (err?.name !== "NotAllowedError") {
        console.error("Failed to start screen share:", err);
      }
      return;
    }
    const [screenTrack] = displayStream.getVideoTracks();
    if (!screenTrack) return;
    // The call may have ended while the picker was open.
    if (
      peerConnectionRef.current !== pc ||
      pc.signalingState === "closed" ||
      screenTrackRef.current
    ) {
      displayStream.getTracks().forEach((t) => t.stop());
      return;
    }
    if ("contentHint" in screenTrack) screenTrack.contentHint = "detail";
    screenTrackRef.current = screenTrack;

    try {
      const { sender, needsNegotiation } = await attachOutgoingVideoTrack(
        pc,
        screenTrack,
        localStreamRef.current,
      );
      videoSenderRef.current = sender;
      let audioNeedsNegotiation = false;
      const [screenAudio] = displayStream.getAudioTracks();
      if (screenAudio) {
        try {
          if (screenAudioSenderRef.current) {
            // A silent audio m-line was left by an earlier share.
            await screenAudioSenderRef.current.replaceTrack(screenAudio);
          } else {
            // Screen audio is a second audio track; it needs a new m-line.
            screenAudioSenderRef.current = pc.addTrack(
              screenAudio,
              displayStream,
            );
            audioNeedsNegotiation = true;
          }
        } catch (err) {
          console.error("Failed to send screen audio:", err);
          screenAudioSenderRef.current = null;
        }
      }
      if (needsNegotiation || audioNeedsNegotiation) await sendOffer(pc);
    } catch (err) {
      console.error("Failed to send screen share:", err);
      screenTrackRef.current = null;
      try {
        screenTrack.stop();
      } catch (_) {}
      return;
    }

    // The browser's own "Stop sharing" control ends the track.
    screenTrack.onended = () => {
      void stopScreenShare();
    };
    setIsScreenSharing(true);
    void postSignal("screen-share-state", {
      chatId: callChatIdRef.current,
      sharing: true,
    });
  }, [postSignal, sendOffer, stopScreenShare]);

  const toggleScreenShare = useCallback(() => {
    if (screenTrackRef.current) return stopScreenShare();
    return startScreenShare();
  }, [startScreenShare, stopScreenShare]);

  // Handle incoming signaling messages
  const handleSignal = useCallback(
    async (payload) => {
      if (!payload?.type) return;

      switch (payload.type) {
        case "call:incoming": {
          // Do not auto-reject from an insecure/unsupported tab: the user may
          // have another HTTPS or mobile session open that can still answer.
          if (!isCallSupported()) {
            return;
          }

          // Busy: reject second call if already active
          if (callStateRef.current !== "idle") {
            void postSignal("reject", {
              chatId: payload.chatId,
              reason: "busy",
            });
            return;
          }
          isPolitePeerRef.current = true;
          setCallState("ringing");
          callStateRef.current = "ringing";
          setCallType(payload.callType || "voice");
          callTypeRef.current = payload.callType || "voice";
          // Voice calls start with camera off, video calls with camera on.
          setIsCameraOff((payload.callType || "voice") !== "video");
          setIsRemoteCameraOff((payload.callType || "voice") !== "video");
          setCallChatId(String(payload.chatId));
          callChatIdRef.current = String(payload.chatId);
          setCallPeer({
            username: payload.caller?.username || payload.callerUsername,
            nickname: payload.caller?.nickname || payload.callerNickname,
            avatar: payload.caller?.avatarUrl || payload.callerAvatar,
            color: payload.caller?.color || payload.callerColor,
            verified: payload.caller?.verified ?? payload.callerVerified,
            role: payload.caller?.role || payload.callerRole,
          });
          break;
        }

        case "call:accepted": {
          if (
            callStateRef.current !== "calling" ||
            String(payload.chatId) !== String(callChatIdRef.current)
          ) {
            return;
          }
          try {
            const pc = await createPeerConnection();
            if (localStreamRef.current) {
              localStreamRef.current
                .getTracks()
                .forEach((track) => pc.addTrack(track, localStreamRef.current));
            }
            
            if (!localStreamRef.current?.getVideoTracks().length) {
              pc.addTransceiver("video", { direction: "recvonly" });
            }
            await sendOffer(pc);
          } catch (err) {
            console.error("Failed to create offer:", err);
            finishCall("failed");
          }
          break;
        }

        case "call:offer": {
          if (
            callChatIdRef.current &&
            String(payload.chatId) !== String(callChatIdRef.current)
          ) {
            return;
          }
          const sdpOffer = payload.sdp || payload.offer;
          try {
            let pc = peerConnectionRef.current;
            if (!pc) {
              pc = await createPeerConnection();
              if (localStreamRef.current) {
                localStreamRef.current
                  .getTracks()
                  .forEach((track) =>
                    pc.addTrack(track, localStreamRef.current)
                  );
              }
            }
            const isReadyForOffer =
              !isMakingOfferRef.current &&
              (pc.signalingState === "stable" ||
                isSettingRemoteAnswerRef.current);
            if (!isReadyForOffer && !isPolitePeerRef.current) break;
            // For the polite peer this implicitly rolls back its own offer.
            await pc.setRemoteDescription(new RTCSessionDescription(sdpOffer));

            // Flush queued ICE candidates
            while (pendingCandidatesRef.current.length > 0) {
              const cand = pendingCandidatesRef.current.shift();
              try {
                await pc.addIceCandidate(new RTCIceCandidate(cand));
              } catch (_) {}
            }

            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            const answerRes = await postSignal("answer", {
              chatId: callChatIdRef.current,
              sdp: answer,
            });
            if (!answerRes || answerRes.ok === false) {
              finishCall("failed", {
                kind: "signaling",
                code: answerRes?.code || "answer_failed",
                message: answerRes?.error,
              });
              break;
            }
            // Whatever the rolled-back offer carried still has to go out.
            if (!isReadyForOffer && hasUnnegotiatedSend(pc)) {
              await sendOffer(pc);
            }
          } catch (err: any) {
            console.error("Failed to handle offer:", err);
            finishCall("failed", {
              kind: "signaling",
              code: "handshake_failed",
              message: err?.message,
            });
          }
          break;
        }

        case "call:answer": {
          if (
            callChatIdRef.current &&
            String(payload.chatId) !== String(callChatIdRef.current)
          ) {
            return;
          }
          const sdpAnswer = payload.sdp || payload.answer;
          if (!sdpAnswer) break;
          try {
            const pc = peerConnectionRef.current;
            if (pc && pc.signalingState !== "closed") {
              isSettingRemoteAnswerRef.current = true;
              try {
                await pc.setRemoteDescription(new RTCSessionDescription(sdpAnswer));
              } finally {
                isSettingRemoteAnswerRef.current = false;
              }
              while (pendingCandidatesRef.current.length > 0) {
                const cand = pendingCandidatesRef.current.shift();
                try {
                  await pc.addIceCandidate(new RTCIceCandidate(cand));
                } catch (_) {}
              }
              // Handshake done: move caller out of "calling".
              setCallState("connected");
              callStateRef.current = "connected";
              if (!durationTimerRef.current) {
                durationTimerRef.current = setInterval(() => {
                  setCallDuration((prev) => prev + 1);
                }, 1000);
              }
            }
          } catch (err: any) {
            console.error("Failed to handle answer:", err);
            finishCall("failed", {
              kind: "signaling",
              code: "handshake_failed",
              message: err?.message,
            });
          }
          break;
        }

        case "call:ice-candidate": {
          if (
            callChatIdRef.current &&
            String(payload.chatId) !== String(callChatIdRef.current)
          ) {
            return;
          }
          const cand = payload.candidate;
          if (!cand) return;
          const pc = peerConnectionRef.current;
          if (pc && pc.remoteDescription && pc.signalingState !== "closed") {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(cand));
            } catch {
              // candidate may be stale (e.g. after renegotiation); safe to drop
            }
          } else {
            pendingCandidatesRef.current.push(cand);
          }
          break;
        }

        case "call:camera-state": {
          if (
            callChatIdRef.current &&
            String(payload.chatId) !== String(callChatIdRef.current)
          ) {
            return;
          }
          const remoteOff = payload.cameraOff !== false;
          setIsRemoteCameraOff(remoteOff);
          if (remoteOff === false) {
            setCallType("video");
            callTypeRef.current = "video";
          }
          break;
        }

        case "call:screen-share-state": {
          if (
            callChatIdRef.current &&
            String(payload.chatId) !== String(callChatIdRef.current)
          ) {
            return;
          }
          setIsRemoteScreenSharing(payload.sharing === true);
          break;
        }

        case "call:ring-ended": {
          if (
            callStateRef.current === "ringing" &&
            callChatIdRef.current &&
            String(payload.chatId) === String(callChatIdRef.current)
          ) {
            beginCallExit();
          }
          break;
        }

        case "call:rejected": {
          if (
            callChatIdRef.current &&
            String(payload.chatId) !== String(callChatIdRef.current)
          ) {
            return;
          }
          if (payload.reason === "unsupported") {
            finishCall("failed", { kind: "rejected", code: "unsupported" });
          } else if (payload.reason === "peer_media_failed") {
            finishCall("peer_media_failed", {
              kind: "rejected",
              code: "peer_media_failed",
            });
          } else if (payload.reason === "busy") {
            finishCall("busy", { kind: "rejected", code: "busy" });
          } else {
            finishCall("declined");
          }
          break;
        }

        case "call:ended": {
          if (
            callChatIdRef.current &&
            String(payload.chatId) !== String(callChatIdRef.current)
          ) {
            return;
          }
          if (payload.reason === "missed") {
            finishCall("missed");
          } else if (payload.reason === "failed") {
            finishCall("failed");
          } else {
            finishCall("ended");
          }
          break;
        }

        case "call:error": {
          if (
            !payload.chatId ||
            (callChatIdRef.current &&
              String(payload.chatId) === String(callChatIdRef.current))
          ) {
            if (payload.code === "callee_busy") {
              finishCall("busy", {
                kind: "server",
                code: "callee_busy",
                message: payload.error,
              });
            } else {
              finishCall("failed", {
                kind: "server",
                code: payload.code || "signaling_error",
                message: payload.error,
              });
            }
          }
          break;
        }

        default:
          break;
      }
    },
    [createPeerConnection, postSignal, finishCall, beginCallExit, sendOffer]
  );

  // Recover a call that started while this app was closed.
  useEffect(() => {
    let isCancelled = false;
    void fetchIncomingCall().then((payload) => {
      if (!isCancelled && payload?.call) {
        void handleSignal(payload.call);
      }
    });
    return () => {
      isCancelled = true;
    };
  }, [handleSignal]);

  // Auto cleanup on unmount
  useEffect(() => {
    return () => {
      resetCallState();
    };
  }, [resetCallState]);

  return {
    callState,
    callEndReason,
    callFailureDetail,
    isCallClosing,
    callType,
    callChatId,
    callPeer,
    callDuration,
    callQuality,
    isMuted,
    isCameraOff,
    isCameraUnavailable,
    isRemoteCameraOff,
    isSpeakerOn,
    isScreenSharing,
    isRemoteScreenSharing,
    isScreenAudioMuted,
    localVideoRef,
    remoteVideoRef,
    remoteAudioRef,
    screenAudioRef,
    screenAudioStreamRef,
    startCall,
    acceptCall,
    rejectCall,
    endCall,
    toggleMute,
    toggleCamera,
    toggleSpeaker,
    toggleScreenAudio,
    startScreenShare,
    stopScreenShare,
    toggleScreenShare,
    flipCamera,
    canFlipCamera:
      hasMultipleCameras &&
      callState === "connected" &&
      !isCameraOff &&
      !isCameraUnavailable &&
      !isScreenSharing,
    handleSignal,
  };
}
