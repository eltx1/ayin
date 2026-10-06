"use client";

import { useCallback, useLayoutEffect, useRef, type RefObject } from "react";
import { AccountScopeError } from "@/lib/account-scope";
import type { AyinPlayerAnalytics } from "@/lib/ayin-player";
import {
  persistWatchProgress,
  WatchProgressConflictError,
  readWatchProgress,
  resumablePositionMs,
  shouldPersistProgress,
  type PlayerProgressScope,
} from "@/lib/player-progress";

export interface PlayerProgressIdentity {
  accountId: string;
  profileId: string;
  revision: number;
  isCurrent: () => boolean;
  onBeforeSuspend: (listener: () => void) => () => void;
}
interface ProgressRun {
  controller: AbortController;
  scope: PlayerProgressScope | null;
  isCurrent: () => boolean;
  reading: boolean;
  retryRead: (() => Promise<void>) | null;
  loaded: boolean;
  resume: number | null;
  resetPosition: boolean;
  lastAcknowledgedAt: number;
  lastAcknowledgedPosition: number;
  revision: string | null;
  awaitingExplicitCheckpoint: boolean;
  lastAttemptAt: number;
  busy: boolean;
  pending: { keepalive: boolean } | null;
}

// This owns only this mounted player's progress operations. Identity authority
// and lifecycle revalidation remain with the existing ViewerProductProvider.
export function useWatchProgress({
  videoId,
  videoRef,
  identity,
  enabled,
  initialPositionMs,
  durationMs,
  intervalMs,
  adActiveRef,
  analytics,
  onPosition,
  onIdentityInvalid,
  canPersist,
}: {
  videoId: string;
  videoRef: RefObject<HTMLVideoElement | null>;
  identity?: PlayerProgressIdentity | null | undefined;
  enabled: boolean;
  initialPositionMs: number;
  durationMs: number | null;
  intervalMs: number;
  adActiveRef: RefObject<boolean>;
  analytics: AyinPlayerAnalytics;
  onPosition: (positionMs: number) => void;
  onIdentityInvalid?: (() => void) | undefined;
  canPersist?: (() => boolean) | undefined;
}) {
  const current = useRef<ProgressRun | null>(null);
  const playback = useRef({
    videoId,
    owner: "",
    touched: false,
    initialPositionMs,
    nativeSeekTargetMs: null as number | null,
  });
  const accountId = identity?.accountId;
  const profileId = identity?.profileId;
  const revision = identity?.revision;
  const identityIsCurrent = identity?.isCurrent;
  const onBeforeSuspend = identity?.onBeforeSuspend;

  const applyResume = useCallback(() => {
    const run = current.current;
    const video = videoRef.current;
    if (
      !run ||
      run.controller.signal.aborted ||
      !run.isCurrent() ||
      !video ||
      video.readyState < 1 ||
      run.resume === null ||
      playback.current.touched ||
      adActiveRef.current
    )
      return;
    const mediaDurationMs = Number.isFinite(video.duration) ? video.duration * 1000 : durationMs;
    const safePositionMs = Math.min(
      run.resume,
      mediaDurationMs && mediaDurationMs > 0 ? Math.max(0, mediaDurationMs - 250) : run.resume,
    );
    try {
      if (safePositionMs > 0 || run.resetPosition) {
        playback.current.nativeSeekTargetMs = safePositionMs;
        video.currentTime = safePositionMs / 1000;
        onPosition(safePositionMs);
      }
      run.resetPosition = false;
      playback.current.touched = true;
      run.resume = null;
    } catch {
      playback.current.nativeSeekTargetMs = null;
      // Some media engines cannot seek until canplay; that event may retry.
    }
  }, [adActiveRef, durationMs, onPosition, videoRef]);

  const markUserSeek = useCallback(() => {
    playback.current.nativeSeekTargetMs = null;
    playback.current.touched = true;
    if (current.current) current.current.resume = null;
  }, []);

  // Native controls also emit seeking for our own resume/reset assignments.
  // Keep those events separate from deliberate native input, just as Watch's
  // custom controls already call markUserSeek only for an explicit seek.
  const markNativeSeek = useCallback(() => {
    const target = playback.current.nativeSeekTargetMs;
    const position = (videoRef.current?.currentTime ?? 0) * 1000;
    if (target !== null && Math.abs(position - target) < 250) return false;
    markUserSeek();
    return true;
  }, [markUserSeek, videoRef]);
  const finishNativeSeek = useCallback(() => {
    // A prior seek's queued seeked event can arrive after a newer internal
    // reset has started. Keep that newer target until its seek actually ends.
    if (videoRef.current?.seeking) return;
    playback.current.nativeSeekTargetMs = null;
  }, [videoRef]);

  const invalidate = useCallback(
    (run: ProgressRun, error: unknown) => {
      if (current.current !== run || run.controller.signal.aborted || !run.isCurrent()) return;
      if (error instanceof AccountScopeError && [401, 403, 409].includes(error.status)) {
        run.controller.abort();
        run.resume = null;
        run.pending = null;
        // 403 can mean an unavailable video or selected profile, not a changed
        // account. Wait for the next lifecycle revalidation rather than looping.
        if (error.status !== 403) onIdentityInvalid?.();
      }
    },
    [onIdentityInvalid],
  );

  const persist = useCallback(
    async function checkpoint(force = false, keepalive = false): Promise<void> {
      const run = current.current;
      const video = videoRef.current;
      if (
        !enabled ||
        !run?.scope ||
        run.controller.signal.aborted ||
        !run.isCurrent() ||
        (canPersist && !canPersist()) ||
        !video ||
        adActiveRef.current
      )
        return;
      if (run.awaitingExplicitCheckpoint && !force) return;
      if (!run.loaded || run.busy) {
        // Suspension is one best-effort immutable snapshot, never a deferred
        // read/replay. Keep outstanding writes single-flight rather than race
        // an older in-flight value against a new final checkpoint.
        if (keepalive) return;
        if (force) {
          run.pending = { keepalive: keepalive || Boolean(run.pending?.keepalive) };
          // A failed initial read is recoverable on the next explicit pause or
          // lifecycle checkpoint. Routine timeupdate events never spin a retry.
          if (!run.loaded && !run.reading) void run.retryRead?.();
        }
        return;
      }
      // A pause before media readiness must not overwrite an unapplied resume
      // with zero (or an old owner's time when the engine deferred the reset).
      if (run.resetPosition || (run.resume !== null && !playback.current.touched)) return;
      const positionMs = Math.max(0, Math.floor(video.currentTime * 1000));
      const nowMs = Date.now();
      if (
        !shouldPersistProgress({
          nowMs,
          lastPersistedAtMs: Math.max(run.lastAcknowledgedAt, run.lastAttemptAt),
          positionMs,
          lastPersistedPositionMs: run.lastAcknowledgedPosition,
          intervalMs,
          force,
        })
      )
        return;
      run.busy = true;
      run.awaitingExplicitCheckpoint = false;
      run.lastAttemptAt = nowMs;
      try {
        const mediaDurationMs = Number.isFinite(video.duration)
          ? Math.floor(video.duration * 1000)
          : durationMs;
        const snapshot = await persistWatchProgress(
          videoId,
          {
            positionMs,
            expectedRevision: run.revision,
            ...(mediaDurationMs && mediaDurationMs > 0 ? { durationMs: mediaDurationMs } : {}),
          },
          run.scope,
          keepalive,
        );
        if (current.current !== run || run.controller.signal.aborted || !run.isCurrent()) return;
        // Only a validated response for this exact run advances the ACK. Failed or
        // lost ACKs remain retryable on a later checkpoint; no background retry loop.
        run.lastAcknowledgedAt = Date.now();
        run.lastAcknowledgedPosition = snapshot.positionMs;
        run.revision = snapshot.revision;
        analytics.emit({ type: "progress_checkpoint", videoId, positionMs: snapshot.positionMs });
        if (snapshot.completedAt) analytics.emit({ type: "complete", videoId });
      } catch (error) {
        if (error instanceof WatchProgressConflictError) {
          if (current.current === run && !run.controller.signal.aborted && run.isCurrent()) {
            // A competing/previously unacknowledged checkpoint won. Refresh the
            // baseline, but never replay the conflicted payload or queued intent.
            run.loaded = false;
            run.awaitingExplicitCheckpoint = true;
            run.pending = null;
            void run.retryRead?.();
          }
        } else invalidate(run, error);
      } finally {
        run.busy = false;
        const pending = run.pending;
        run.pending = null;
        if (pending && current.current === run && !run.controller.signal.aborted && run.isCurrent())
          await checkpoint(true, pending.keepalive);
      }
    },
    [
      adActiveRef,
      analytics,
      canPersist,
      durationMs,
      enabled,
      intervalMs,
      invalidate,
      videoId,
      videoRef,
    ],
  );

  useLayoutEffect(() => {
    const controller = new AbortController();
    const owner = accountId && profileId ? `${accountId}:${profileId}` : "";
    const prior = playback.current;
    const videoChanged = prior.videoId !== videoId;
    const ownerChanged = Boolean(owner && prior.owner && owner !== prior.owner);
    const initialChanged = prior.initialPositionMs !== initialPositionMs;
    if (videoChanged || ownerChanged || initialChanged) {
      playback.current = {
        videoId,
        owner,
        touched: false,
        initialPositionMs,
        nativeSeekTargetMs: null,
      };
    } else if (owner) {
      // Preserve deliberate seek/current playback across same-account focus
      // revalidation. A new verified account/profile starts a separate timeline.
      playback.current.owner = owner;
    }
    const scope =
      enabled && accountId && profileId
        ? { accountId, profileId, signal: controller.signal }
        : null;
    const run: ProgressRun = {
      controller,
      scope,
      isCurrent: () => !scope || Boolean(identityIsCurrent?.()),
      reading: false,
      retryRead: null,
      loaded: false,
      resume: initialPositionMs > 0 ? initialPositionMs : null,
      resetPosition: ownerChanged,
      lastAcknowledgedAt: 0,
      lastAcknowledgedPosition: 0,
      revision: null,
      awaitingExplicitCheckpoint: false,
      lastAttemptAt: 0,
      busy: false,
      pending: null,
    };
    current.current = run;
    if (ownerChanged) {
      // Do not carry A's current media time into B, even before B's read resolves.
      const video = videoRef.current;
      if (video) {
        try {
          playback.current.nativeSeekTargetMs = 0;
          video.currentTime = 0;
          run.resetPosition = false;
        } catch {
          playback.current.nativeSeekTargetMs = null;
          /* Readiness can lag behind identity. */
        }
      }
      onPosition(0);
    }
    const stopListening = scope
      ? onBeforeSuspend?.(() => {
          if (current.current === run) void persist(true, true);
        })
      : undefined;
    applyResume();
    if (scope) {
      run.retryRead = async () => {
        if (run.reading || controller.signal.aborted || current.current !== run || !run.isCurrent())
          return;
        run.reading = true;
        try {
          const snapshot = await readWatchProgress(videoId, scope);
          if (current.current !== run || controller.signal.aborted || !run.isCurrent()) return;
          run.loaded = true;
          run.lastAcknowledgedPosition = snapshot.positionMs;
          run.revision = snapshot.revision;
          run.lastAcknowledgedAt = Date.now();
          run.resume =
            initialPositionMs > 0 ? initialPositionMs : resumablePositionMs(snapshot, durationMs);
          applyResume();
          const pending = run.pending;
          run.pending = null;
          if (pending) void persist(true, pending.keepalive);
        } catch (error) {
          invalidate(run, error);
        } finally {
          run.reading = false;
        }
      };
      void run.retryRead();
    }
    return () => {
      stopListening?.();
      controller.abort();
      run.retryRead = null;
      run.resume = null;
      run.pending = null;
      if (current.current === run) current.current = null;
    };
  }, [
    accountId,
    profileId,
    revision,
    identityIsCurrent,
    onBeforeSuspend,
    enabled,
    initialPositionMs,
    videoId,
    durationMs,
    applyResume,
    invalidate,
    onPosition,
    persist,
    videoRef,
  ]);

  return { applyResume, markUserSeek, markNativeSeek, finishNativeSeek, persist };
}
