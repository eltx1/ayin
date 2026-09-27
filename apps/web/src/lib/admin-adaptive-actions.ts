import { apiBaseUrl } from "./api";
import { readAdminApiError } from "./admin-reauthentication";

// INCOMPLETE_HLS stays unexposed until candidate-selection fairness is verified.
export const recoveryModes = [
  "STALE_PROCESSING",
  "FAILED_BACKFILL",
  "DB_MANIFEST_MISSING",
  "VERIFIED_HLS_MISSING_DB",
] as const;
export type RecoveryMode = (typeof recoveryModes)[number];
export type AdaptiveAction =
  | { kind: "backfill"; batchSize: number }
  | { kind: "pause" }
  | { kind: "resume" }
  | { kind: "recovery"; mode: RecoveryMode; batchSize: number; cursor?: string };
export interface AdaptiveOutcome {
  audited: boolean;
  paused?: boolean;
  queued?: number;
  recovered?: number;
  failed?: number;
  detected?: number;
  scanned?: number;
  reason?: "BACKFILL_DISABLED_OR_PAUSED" | "IN_FLIGHT_LIMIT" | "NO_ELIGIBLE_VIDEO";
  continuation?: { cursor: string | null; hasMore: boolean };
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const invalidResult = () =>
  new Error(
    "Unable to verify the action result. Refresh the current state before submitting again.",
  );

// Reject an unexpected success body rather than claiming unverified queue/audit outcomes.
export function readAdaptiveOutcome(action: AdaptiveAction, value: unknown): AdaptiveOutcome {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalidResult();
  const data = value as Record<string, unknown>;
  const count = (key: string): number => {
    const value = data[key];
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
      throw invalidResult();
    return value;
  };
  if (action.kind === "pause" || action.kind === "resume") {
    if (data.backfillPaused !== (action.kind === "pause")) throw invalidResult();
    return { paused: data.backfillPaused as boolean, audited: true };
  }
  if (data.reason === "BACKFILL_DISABLED_OR_PAUSED") {
    if (count(action.kind === "backfill" ? "enqueued" : "recovered") !== 0) throw invalidResult();
    return { reason: data.reason, audited: false };
  }
  if (action.kind === "backfill") {
    if (!["ENQUEUED", "NO_ELIGIBLE_VIDEO", "IN_FLIGHT_LIMIT"].includes(String(data.reason)))
      throw invalidResult();
    return {
      queued: count("enqueued"),
      audited: true,
      ...(data.reason === "ENQUEUED"
        ? {}
        : { reason: data.reason as NonNullable<AdaptiveOutcome["reason"]> }),
    };
  }
  if (data.mode !== action.mode) throw invalidResult();
  if (data.reason !== undefined && data.reason !== "IN_FLIGHT_LIMIT") throw invalidResult();
  const result: AdaptiveOutcome = {
    audited: true,
    ...(data.reason === "IN_FLIGHT_LIMIT" ? { reason: data.reason } : {}),
  };
  if (action.mode === "FAILED_BACKFILL") return { ...result, queued: count("recovered") };
  if (action.mode === "STALE_PROCESSING") {
    const recovered = count("recovered"),
      queued = count("requeued"),
      failed = count("failed");
    if (recovered !== queued + failed) throw invalidResult();
    return { ...result, recovered, queued, failed };
  }
  const cursor = data.nextCursor;
  if (cursor !== null && (typeof cursor !== "string" || !uuid.test(cursor))) throw invalidResult();
  const hasMore = action.mode === "VERIFIED_HLS_MISSING_DB" ? data.hasMore : cursor !== null;
  if (typeof hasMore !== "boolean") throw invalidResult();
  return {
    ...result,
    detected: count("detected"),
    queued: count("requeued"),
    scanned: count("scanned"),
    continuation: { cursor: cursor as string | null, hasMore },
  };
}

export async function submitAdaptiveAction(
  action: AdaptiveAction,
  signal: AbortSignal,
): Promise<AdaptiveOutcome> {
  if (
    "batchSize" in action &&
    (!Number.isInteger(action.batchSize) || action.batchSize < 1 || action.batchSize > 20)
  )
    throw new Error("Choose a batch size from 1 to 20.");
  if (
    action.kind === "recovery" &&
    (!recoveryModes.includes(action.mode) ||
      (action.cursor !== undefined && !uuid.test(action.cursor)))
  )
    throw new Error("Invalid recovery request.");
  const path =
    action.kind === "recovery"
      ? "recovery"
      : `backfill/${action.kind === "backfill" ? "run" : action.kind}`;
  const body =
    action.kind === "backfill"
      ? { batchSize: action.batchSize }
      : action.kind === "recovery"
        ? {
            mode: action.mode,
            batchSize: action.batchSize,
            ...(action.cursor ? { cursor: action.cursor } : {}),
          }
        : undefined;
  const response = await fetch(`${apiBaseUrl}/admin/media-processing/adaptive-rollout/${path}`, {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    signal,
    ...(body
      ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
      : {}),
  });
  if (!response.ok) throw new Error(await readAdminApiError(response));
  return readAdaptiveOutcome(action, await response.json());
}

export function adaptiveLabel(action: AdaptiveAction, ar: boolean): string {
  const labels: Record<RecoveryMode, [string, string]> = {
    STALE_PROCESSING: ["Recover expired processing", "استعادة المعالجة منتهية المهلة"],
    FAILED_BACKFILL: ["Retry failed conversions", "إعادة محاولة التحويلات الفاشلة"],
    DB_MANIFEST_MISSING: ["Check missing playback files", "فحص ملفات التشغيل المفقودة"],
    VERIFIED_HLS_MISSING_DB: [
      "Reconcile unregistered playback",
      "مطابقة ملفات التشغيل غير المسجلة",
    ],
  };
  if (action.kind === "recovery") return labels[action.mode][ar ? 1 : 0];
  return action.kind === "backfill"
    ? ar
      ? "تحويل دفعة من المحتوى السابق"
      : "Convert a catalog batch"
    : action.kind === "pause"
      ? ar
        ? "إيقاف التحويل مؤقتًا"
        : "Pause catalog conversion"
      : ar
        ? "استئناف التحويل"
        : "Resume catalog conversion";
}

export function adaptiveDescription(action: AdaptiveAction, ar: boolean): string {
  if (action.kind === "pause")
    return ar
      ? "يمنع التحويلات الجديدة بعد انتهاء الدفعة الجارية. لا يلغي المهام الموجودة ولا يوقف العمل الذي بدأ بالفعل."
      : "Block new conversions after a batch already in progress finishes. Existing jobs are not cancelled and already claimed work may finish.";
  if (action.kind === "resume")
    return ar
      ? "السماح باستئناف المهام المنتظرة. لا يبدأ تحويل كامل المكتبة تلقائيًا."
      : "Allow queued conversions to resume. This does not automatically convert the entire catalog.";
  if (action.kind === "backfill")
    return ar
      ? "إدراج دفعة محدودة من الفيديوهات المؤهلة للتحويل إلى تشغيل تكيفي. يستهلك ذلك سعة معالجة وتخزين."
      : "Queue a bounded batch of eligible videos for adaptive playback. This uses processing capacity and storage.";
  if (action.mode === "STALE_PROCESSING")
    return ar
      ? "استعادة مهام المعالجة التي انتهت مهلة عاملها. قد تُعاد إلى الطابور أو تُسجّل فاشلة عند نفاد المحاولات. يشمل ذلك الرفع العادي ويعمل أثناء إيقاف التحويل."
      : "Recover jobs whose worker lease expired. Jobs may be requeued or marked failed when retries are exhausted. This includes normal uploads and works while catalog conversion is paused.";
  if (action.mode === "FAILED_BACKFILL")
    return ar
      ? "إعادة إدراج التحويلات الفاشلة المؤهلة ضمن حد السعة الحالي."
      : "Requeue eligible failed conversions within the current capacity limit.";
  if (action.mode === "DB_MANIFEST_MISSING")
    return ar
      ? "فحص حتى 250 سجل تشغيل. يُسجّل الملف المؤكد فقدانه أو فراغه كغير جاهز، وتُدرج إعادة المعالجة إذا توفرت السعة. تعذّر التحقق من التخزين يوقف العملية دون تعديل."
      : "Check up to 250 playback records. Confirmed missing or empty files are marked unavailable, with reprocessing queued when capacity permits. Uncertain storage checks abort without changes.";
  return ar
    ? "فحص حتى 250 فيديو بحثًا عن ملفات تشغيل بلا سجل مطابق، ثم إدراج جيل معالجة جديد عند توفر السعة. لا تُعتمد الملفات تلقائيًا. الاستكمال يدوي."
    : "Check up to 250 videos for playback files without matching records, then queue a new generation when capacity permits. Files are not automatically adopted. Continuation is manual.";
}

export function adaptiveFeedback(result: AdaptiveOutcome, ar: boolean): string {
  const parts: string[] = [];
  if (result.paused !== undefined)
    parts.push(
      result.paused
        ? ar
          ? "أُوقف التحويل مؤقتًا. لم تُلغَ المهام الموجودة."
          : "Catalog conversion paused. Existing jobs were not cancelled."
        : ar
          ? "سُمح باستئناف التحويل."
          : "Catalog conversion resumed.",
    );
  if (result.scanned !== undefined)
    parts.push(
      ar
        ? `فُحص ${result.scanned} سجلًا؛ رُصد ${result.detected}.`
        : `Scanned ${result.scanned}; detected ${result.detected}.`,
    );
  if (result.queued !== undefined)
    parts.push(
      ar
        ? `أُدرج ${result.queued} في الطابور؛ لم تكتمل المعالجة بعد.`
        : `Queued ${result.queued}; processing is not complete.`,
    );
  if (result.failed !== undefined)
    parts.push(ar ? `سُجّلت ${result.failed} مهمة فاشلة.` : `Marked ${result.failed} jobs failed.`);
  if (result.reason === "BACKFILL_DISABLED_OR_PAUSED")
    parts.push(
      ar
        ? "التحويل معطّل أو موقوف؛ لم يُنفذ إجراء ولم يُنشأ سجل تدقيق لهذا الطلب."
        : "Conversion is disabled or paused. No action or audit was created for this request.",
    );
  if (result.reason === "IN_FLIGHT_LIMIT")
    parts.push(
      ar
        ? "السعة ممتلئة؛ انتظر توفرها قبل المحاولة مجددًا."
        : "Capacity is full. Wait for capacity before trying again.",
    );
  if (result.reason === "NO_ELIGIBLE_VIDEO")
    parts.push(ar ? "لا توجد فيديوهات مؤهلة في هذه الدفعة." : "No eligible videos in this batch.");
  if (result.continuation)
    parts.push(
      result.continuation.hasMore
        ? ar
          ? "بقي فحص إضافي أو مرشحون ينتظرون السعة. استكمل يدويًا عند الجاهزية."
          : "More records or capacity-limited candidates remain. Continue manually when ready."
        : ar
          ? "اكتمل نطاق الفحص الحالي."
          : "The current scan range is complete.",
    );
  if (result.audited) parts.push(ar ? "سُجّل الإجراء للتدقيق." : "The action was audited.");
  return parts.join(" ");
}
