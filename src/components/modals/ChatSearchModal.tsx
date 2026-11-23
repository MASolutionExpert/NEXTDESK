'use client';

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Close, LoaderCircle, Paperclip, Search } from "../../icons/lucide.ts";
import { searchChatMessages } from "../../api/chatApi.ts";
import { useFocusTrap } from "../../hooks/useFocusTrap.ts";
import { hasPersian } from "../../utils/fontUtils.ts";
import { parseServerDate } from "../../utils/chatFormat.ts";
import { useI18n } from "../../i18n/index.ts";

const PAGE_SIZE = 30;
const DEBOUNCE_MS = 240;

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

function renderHighlighted(text: string, query: string) {
  const source = String(text || "");
  const needle = String(query || "").trim();
  if (!needle) return source;
  const lowerSource = source.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  const parts: any[] = [];
  let cursor = 0;
  let idx = lowerSource.indexOf(lowerNeedle, cursor);
  let key = 0;
  while (idx !== -1) {
    if (idx > cursor) {
      parts.push(source.slice(cursor, idx));
    }
    parts.push(
      <mark
        key={key++}
        className="rounded bg-amber-200/90 px-0.5 text-slate-900 dark:bg-amber-400/35 dark:text-amber-100"
      >
        {source.slice(idx, idx + needle.length)}
      </mark>,
    );
    cursor = idx + needle.length;
    idx = lowerSource.indexOf(lowerNeedle, cursor);
  }
  if (cursor < source.length) {
    parts.push(source.slice(cursor));
  }
  return parts;
}

export default function ChatSearchModal({
  open,
  chatId,
  username,
  onClose,
  onJumpToMessage,
}: any) {
  const { t, language } = useI18n();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const requestIdRef = useRef(0);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [searchedQuery, setSearchedQuery] = useState("");

  useFocusTrap(dialogRef, { active: Boolean(open), onEscape: onClose });

  const executeSearch = useCallback(
    async (term: string, offset: number, append: boolean) => {
      const cleaned = term.trim();
      if (!chatId || !username || !cleaned) {
        setResults([]);
        setHasMore(false);
        setSearchedQuery("");
        setLoading(false);
        setLoadingMore(false);
        return;
      }
      const reqId = ++requestIdRef.current;
      try {
        if (append) setLoadingMore(true);
        else setLoading(true);
        setError("");
        const res = await searchChatMessages({
          chatId,
          username,
          query: cleaned,
          limit: PAGE_SIZE,
          offset,
        });
        const data = await res.json().catch(() => ({}));
        if (reqId !== requestIdRef.current) return;
        if (!res.ok) {
          throw new Error(data?.error || t("modals.threadSearch.loadError"));
        }
        const rows = Array.isArray(data.results) ? data.results : [];
        setResults((prev) => (append ? [...prev, ...rows] : rows));
        setHasMore(Boolean(data.hasMore));
        setSearchedQuery(cleaned);
      } catch (err: any) {
        if (reqId !== requestIdRef.current) return;
        setError(err?.message || t("modals.threadSearch.loadError"));
      } finally {
        if (reqId === requestIdRef.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [chatId, t, username],
  );

  useEffect(() => {
    if (!open) {
      setQuery("");
      setResults([]);
      setHasMore(false);
      setError("");
      setSearchedQuery("");
      return;
    }
    const focusTimer = setTimeout(() => inputRef.current?.focus(), 40);
    return () => clearTimeout(focusTimer);
  }, [open, chatId]);

  useEffect(() => {
    if (!open) return;
    if (!query.trim()) {
      requestIdRef.current += 1;
      setResults([]);
      setHasMore(false);
      setSearchedQuery("");
      setError("");
      setLoading(false);
      return;
    }
    const timer = setTimeout(() => {
      void executeSearch(query, 0, false);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [open, query, executeSearch]);

  if (!open || typeof document === "undefined") return null;

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
        aria-label={t("modals.threadSearch.title")}
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-3xl border border-emerald-200 bg-white shadow-2xl dark:border-emerald-500/30 dark:bg-slate-950"
      >
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4 dark:border-slate-800">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300">
              <Search size={18} />
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-base font-bold text-slate-800 dark:text-slate-100">
                {t("modals.threadSearch.title")}
              </h2>
              {searchedQuery ? (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {hasMore
                    ? t("modals.threadSearch.resultsCountPlus", { count: results.length })
                    : t("modals.threadSearch.resultsCount", { count: results.length })}
                </p>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("modals.threadSearch.close")}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100 cursor-pointer"
          >
            <Close size={18} />
          </button>
        </div>

        <div className="border-b border-slate-100 px-4 py-3 dark:border-slate-800">
          <div className="relative flex items-center">
            <Search
              size={16}
              className="pointer-events-none absolute start-3.5 text-slate-400"
            />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("modals.threadSearch.placeholder")}
              dir="auto"
              className="w-full rounded-2xl border border-emerald-200 bg-slate-50 py-2.5 pe-9 ps-10 text-sm text-slate-800 outline-hidden transition focus:border-emerald-400 focus:bg-white dark:border-emerald-500/30 dark:bg-slate-900 dark:text-slate-100 dark:focus:bg-slate-950"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="absolute end-2.5 inline-flex h-6 w-6 items-center justify-center rounded-full text-slate-400 hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200 cursor-pointer"
              >
                <Close size={14} />
              </button>
            ) : null}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {loading ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-sm text-slate-500 dark:text-slate-400">
              <LoaderCircle size={22} className="animate-spin text-emerald-500" />
              <span>{t("modals.threadSearch.loading")}</span>
            </div>
          ) : error ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-900/20 dark:text-rose-200">
              {error}
            </div>
          ) : !searchedQuery ? (
            <div className="py-12 text-center text-sm text-slate-500 dark:text-slate-400">
              {t("modals.threadSearch.prompt")}
            </div>
          ) : results.length === 0 ? (
            <div className="py-12 text-center text-sm text-slate-500 dark:text-slate-400">
              {t("modals.threadSearch.empty")}
            </div>
          ) : (
            <ul className="space-y-2">
              {results.map((item) => {
                const senderName = String(item.nickname || item.username || "");
                const body = String(item.body || "");
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onClose?.();
                        onJumpToMessage?.(item.id);
                      }}
                      className="flex w-full flex-col gap-1 rounded-2xl border border-slate-100 bg-slate-50/70 p-3 text-start transition hover:border-emerald-300 hover:bg-emerald-50/50 dark:border-slate-800 dark:bg-slate-900/60 dark:hover:border-emerald-500/35 dark:hover:bg-emerald-500/10 cursor-pointer"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={`truncate text-xs font-bold text-emerald-700 dark:text-emerald-300 ${hasPersian(senderName) ? "font-fa" : ""}`}
                          dir="auto"
                        >
                          {senderName}
                        </span>
                        <span className="shrink-0 text-[11px] text-slate-400 dark:text-slate-500">
                          {formatFullTimestamp(item.createdAt, language)}
                        </span>
                      </div>

                      {body ? (
                        <p
                          className={`line-clamp-3 break-words text-sm text-slate-700 dark:text-slate-200 ${hasPersian(body) ? "font-fa" : ""}`}
                          dir="auto"
                        >
                          {renderHighlighted(body, searchedQuery)}
                        </p>
                      ) : null}

                      {Array.isArray(item.matchedFiles) &&
                      item.matchedFiles.length > 0 ? (
                        <div className="mt-0.5 flex flex-wrap gap-1.5">
                          {item.matchedFiles.map((fname: string, idx: number) => (
                            <span
                              key={`${item.id}-f-${idx}`}
                              className="inline-flex items-center gap-1 rounded-full bg-emerald-100/80 px-2 py-0.5 text-[11px] font-medium text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200"
                            >
                              <Paperclip size={11} />
                              <span>{renderHighlighted(fname, searchedQuery)}</span>
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </button>
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
                onClick={() => void executeSearch(searchedQuery, results.length, true)}
                className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-60 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200 cursor-pointer"
              >
                {loadingMore ? (
                  <LoaderCircle size={14} className="animate-spin" />
                ) : null}
                <span>{t("modals.threadSearch.loadMore")}</span>
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
