'use client';

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowRight,
  Close,
  Download,
  ExternalLink,
  File,
  Files,
  ImageIcon,
  LoaderCircle,
  MoreVertical,
  Music,
  Video,
} from "../../icons/lucide.ts";
import { fetchChatFiles } from "../../api/chatApi.ts";
import { useFocusTrap } from "../../hooks/useFocusTrap.ts";
import { hasPersian } from "../../utils/fontUtils.ts";
import { parseServerDate } from "../../utils/chatFormat.ts";
import { useI18n } from "../../i18n/index.ts";

const PAGE_SIZE = 40;

function formatBytes(bytes: number): string {
  const n = Number(bytes || 0);
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatFullTimestamp(raw: any, locale: string): string {
  const d = parseServerDate(raw);
  if (!d) return "";
  try {
    const datePart = new Intl.DateTimeFormat(locale === "fa" ? "fa-IR" : "en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(d);
    const timePart = new Intl.DateTimeFormat(locale === "fa" ? "fa-IR" : "en-US", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
    return `${datePart} · ${timePart}`;
  } catch {
    return d.toLocaleString();
  }
}

export default function ChatFilesModal({
  open,
  chatId,
  username,
  onClose,
  onJumpToMessage,
}: any) {
  const { t, language } = useI18n();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const [files, setFiles] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [openMenuId, setOpenMenuId] = useState<any>(null);

  useFocusTrap(dialogRef, { active: Boolean(open), onEscape: onClose });

  const loadPage = useCallback(
    async (offset: number, append: boolean) => {
      if (!chatId || !username) return;
      try {
        if (append) setLoadingMore(true);
        else setLoading(true);
        setError("");
        const res = await fetchChatFiles({
          chatId,
          username,
          limit: PAGE_SIZE,
          offset,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data?.error || t("modals.filesGallery.loadError"));
        }
        const rows = Array.isArray(data.files) ? data.files : [];
        setFiles((prev) => (append ? [...prev, ...rows] : rows));
        setTotal(Number(data.total || 0));
        setHasMore(Boolean(data.hasMore));
      } catch (err: any) {
        setError(err?.message || t("modals.filesGallery.loadError"));
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [chatId, t, username],
  );

  useEffect(() => {
    if (!open) {
      setOpenMenuId(null);
      return;
    }
    setFiles([]);
    setTotal(0);
    setHasMore(false);
    void loadPage(0, false);
  }, [open, chatId, loadPage]);

  useEffect(() => {
    if (openMenuId === null) return;
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest?.("[data-file-options-menu]")) {
        setOpenMenuId(null);
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [openMenuId]);

  if (!open || typeof document === "undefined") return null;

  const renderKindIcon = (kind: string) => {
    if (kind === "image") return <ImageIcon size={20} className="text-emerald-500" />;
    if (kind === "video") return <Video size={20} className="text-sky-500" />;
    if (kind === "audio") return <Music size={20} className="text-amber-500" />;
    return <File size={20} className="text-slate-500 dark:text-slate-300" />;
  };

  return createPortal(
    <div
      className="fixed inset-0 z-115 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("modals.filesGallery.title")}
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-3xl border border-emerald-200 bg-white shadow-2xl dark:border-emerald-500/30 dark:bg-slate-950"
      >
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4 dark:border-slate-800">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300">
              <Files size={18} />
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-base font-bold text-slate-800 dark:text-slate-100">
                {t("modals.filesGallery.title")}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t("modals.filesGallery.count", { count: total })}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("modals.filesGallery.close")}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100 cursor-pointer"
          >
            <Close size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {loading ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-sm text-slate-500 dark:text-slate-400">
              <LoaderCircle size={22} className="animate-spin text-emerald-500" />
              <span>{t("modals.filesGallery.loading")}</span>
            </div>
          ) : error ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-900/20 dark:text-rose-200">
              {error}
            </div>
          ) : files.length === 0 ? (
            <div className="py-12 text-center text-sm text-slate-500 dark:text-slate-400">
              {t("modals.filesGallery.empty")}
            </div>
          ) : (
            <ul className="space-y-2">
              {files.map((item) => {
                const fileName = String(item.name || "file");
                const senderName = String(
                  item.sender?.nickname || item.sender?.username || "",
                );
                const thumbSrc =
                  item.thumbUrl || (item.kind === "image" ? item.url : null);
                const menuOpen = openMenuId === item.id;
                return (
                  <li
                    key={`${item.id}-${item.messageId}`}
                    className="relative flex items-center gap-3 rounded-2xl border border-slate-100 bg-slate-50/70 p-2.5 transition hover:border-emerald-200 hover:bg-emerald-50/40 dark:border-slate-800 dark:bg-slate-900/60 dark:hover:border-emerald-500/30"
                  >
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white shadow-xs dark:bg-slate-800">
                      {thumbSrc ? (
                        <img
                          src={thumbSrc}
                          alt={fileName}
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        renderKindIcon(item.kind)
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <p
                          className={`truncate text-sm font-semibold text-slate-800 dark:text-slate-100 ${hasPersian(fileName) ? "font-fa" : ""}`}
                          dir="auto"
                        >
                          {fileName}
                        </p>
                        {item.processing ? (
                          <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-500/20 dark:text-amber-200">
                            {t("modals.filesGallery.processing")}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400">
                        <span>{formatBytes(item.sizeBytes)}</span>
                        {senderName ? (
                          <span
                            className={`truncate max-w-[140px] font-medium text-slate-600 dark:text-slate-300 ${hasPersian(senderName) ? "font-fa" : ""}`}
                            dir="auto"
                          >
                            {senderName}
                          </span>
                        ) : null}
                        <span className="text-[11px] text-slate-400 dark:text-slate-500">
                          {formatFullTimestamp(item.createdAt, language)}
                        </span>
                      </p>
                    </div>

                    <div className="relative shrink-0" data-file-options-menu>
                      <button
                        type="button"
                        onClick={() =>
                          setOpenMenuId((cur: any) =>
                            cur === item.id ? null : item.id,
                          )
                        }
                        aria-label={t("modals.filesGallery.optionsAria")}
                        aria-expanded={menuOpen}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-200/70 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100 cursor-pointer"
                      >
                        <MoreVertical size={16} />
                      </button>

                      {menuOpen ? (
                        <div className="absolute end-0 top-9 z-30 w-44 overflow-hidden rounded-2xl border border-emerald-200 bg-white p-1 text-xs font-semibold text-slate-700 shadow-xl dark:border-emerald-500/30 dark:bg-slate-900 dark:text-slate-100">
                          <a
                            href={item.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={() => setOpenMenuId(null)}
                            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 transition hover:bg-emerald-50 hover:text-emerald-700 dark:hover:bg-emerald-500/15 dark:hover:text-emerald-200"
                          >
                            <ExternalLink size={14} />
                            <span>{t("modals.filesGallery.open")}</span>
                          </a>
                          <a
                            href={item.url}
                            download={fileName}
                            onClick={() => setOpenMenuId(null)}
                            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 transition hover:bg-emerald-50 hover:text-emerald-700 dark:hover:bg-emerald-500/15 dark:hover:text-emerald-200"
                          >
                            <Download size={14} />
                            <span>{t("modals.filesGallery.download")}</span>
                          </a>
                          <button
                            type="button"
                            onClick={() => {
                              setOpenMenuId(null);
                              onClose?.();
                              onJumpToMessage?.(item.messageId);
                            }}
                            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-start transition hover:bg-emerald-50 hover:text-emerald-700 dark:hover:bg-emerald-500/15 dark:hover:text-emerald-200 cursor-pointer"
                          >
                            <ArrowRight size={14} />
                            <span>{t("modals.filesGallery.goToMessage")}</span>
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {hasMore ? (
            <div className="mt-3 flex justify-center">
              <button
                type="button"
                disabled={loadingMore}
                onClick={() => void loadPage(files.length, true)}
                className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-60 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200 cursor-pointer"
              >
                {loadingMore ? (
                  <LoaderCircle size={14} className="animate-spin" />
                ) : null}
                <span>{t("modals.filesGallery.loadMore")}</span>
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
