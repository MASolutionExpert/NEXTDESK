'use client';

import { useEffect, useRef } from "react";

interface SentinelRecord {
  token: string;
  stateKey: string;
  active: boolean;
  seq: number;
}

const sentinelRegistry = new Map<string, SentinelRecord>();
let nextSentinelSeq = 0;

function createSentinelToken(stateKey: string): { token: string; seq: number } {
  nextSentinelSeq += 1;
  return {
    token: `${stateKey}:${nextSentinelSeq}`,
    seq: nextSentinelSeq,
  };
}

function getStateToken(state: any): string | null {
  const token = state?.__sbOverlayToken;
  return typeof token === "string" && token.length > 0 ? token : null;
}

/**
 * Coordinates browser/OS back navigation across stacked overlays (chats,
 * modals, context menus).
 *
 * - Deferred 1-tick close-pop re-checks whether THIS overlay's sentinel is
 *   still the topmost history entry before calling `history.back()`. When a
 *   context menu closes in the same commit that a follow-up dialog opens, the
 *   dialog pushes its sentinel first and the menu skips its pop (marking its
 *   sentinel stale instead of swallowing the dialog's entry).
 * - Module-level sentinel registry tracks ownership so when a subsequent pop
 *   lands on a stale sentinel from an already-closed overlay, active overlays
 *   do NOT mistake it for a back gesture — the stale entry is disposed with a
 *   single follow-up `history.back()`.
 */
export function useOverlayBack(isOpen: any, onClose: any, stateKey = "sbOverlayBack") {
  const pushedRef = useRef(false);
  const tokenRef = useRef<string | null>(null);
  const seqRef = useRef(0);
  const closePopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    if (closePopTimerRef.current !== null) {
      clearTimeout(closePopTimerRef.current);
      closePopTimerRef.current = null;
    }

    if (isOpen && !pushedRef.current) {
      const { token, seq } = createSentinelToken(stateKey);
      sentinelRegistry.set(token, { token, stateKey, active: true, seq });
      tokenRef.current = token;
      seqRef.current = seq;
      pushedRef.current = true;
      window.history.pushState(
        { [stateKey]: true, __sbOverlayToken: token },
        "",
      );
    } else if (!isOpen && pushedRef.current) {
      const closingToken = tokenRef.current;
      pushedRef.current = false;
      tokenRef.current = null;
      seqRef.current = 0;

      if (closingToken) {
        const rec = sentinelRegistry.get(closingToken);
        if (rec) rec.active = false;
      }

      // Defer 1 tick so any follow-up overlay opening in the same React commit
      // pushes its sentinel first; only pop if ours is still the topmost entry.
      closePopTimerRef.current = setTimeout(() => {
        closePopTimerRef.current = null;
        if (!closingToken) return;
        const currentToken = getStateToken(window.history.state);
        if (currentToken === closingToken) {
          sentinelRegistry.delete(closingToken);
          window.history.back();
        }
      }, 0);
    }
  }, [isOpen, stateKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handlePopState = (event: PopStateEvent) => {
      const landedToken = getStateToken(event.state);

      // If this pop landed on an orphaned stale sentinel from a previously
      // closed overlay, dispose it automatically and do NOT close any open
      // overlay sitting underneath it.
      if (landedToken) {
        const landedRecord = sentinelRegistry.get(landedToken);
        if (landedRecord && !landedRecord.active) {
          sentinelRegistry.delete(landedToken);
          window.history.back();
          return;
        }
      }

      if (!pushedRef.current || !tokenRef.current) return;

      // Ignore forward navigation into our own entry.
      if (landedToken === tokenRef.current || event.state?.[stateKey] === true) {
        return;
      }

      // If a newer active overlay is still above us in the history stack,
      // this pop belongs to a sibling/child overlay — stay open.
      if (landedToken) {
        const landedRecord = sentinelRegistry.get(landedToken);
        if (landedRecord && landedRecord.active && landedRecord.seq > seqRef.current) {
          return;
        }
      }

      // Only the topmost active overlay should react to a non-matching pop.
      for (const rec of sentinelRegistry.values()) {
        if (rec.active && rec.seq > seqRef.current) {
          return;
        }
      }

      const myToken = tokenRef.current;
      pushedRef.current = false;
      tokenRef.current = null;
      seqRef.current = 0;
      sentinelRegistry.delete(myToken);
      onCloseRef.current?.();
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [stateKey]);

  // Cleanup on unmount: mark sentinel stale and pop if still topmost.
  useEffect(() => {
    return () => {
      if (closePopTimerRef.current !== null) {
        clearTimeout(closePopTimerRef.current);
        closePopTimerRef.current = null;
      }
      const token = tokenRef.current;
      if (pushedRef.current && token) {
        pushedRef.current = false;
        tokenRef.current = null;
        seqRef.current = 0;
        const rec = sentinelRegistry.get(token);
        if (rec) rec.active = false;
        if (typeof window !== "undefined") {
          setTimeout(() => {
            if (getStateToken(window.history.state) === token) {
              sentinelRegistry.delete(token);
              window.history.back();
            }
          }, 0);
        }
      }
    };
  }, []);
}
