'use client';

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Clock12, Phone, Video } from "../../icons/lucide.ts";
import { api, cardCls, fmtDate, DEFAULT_PAGE_SIZE } from "./adminShared.ts";
import {
  EmptyState,
  FilterPopover,
  LoadingRows,
  Pagination,
  SortTh,
  TabSearchInput,
  TabToolbar,
} from "./AdminCommon.tsx";
import Avatar from "../common/Avatar.tsx";
import ChannelBadge from "../common/ChannelBadge.tsx";
import VerifiedBadge from "../common/VerifiedBadge.tsx";
import UserRoleBadge from "../common/UserRoleBadge.tsx";
import { hasPersian } from "../../utils/fontUtils.ts";
import { useI18n } from "../../i18n/index.ts";

function formatCallDuration(seconds: any) {
  if (seconds == null || !Number.isFinite(Number(seconds)) || Number(seconds) < 0) {
    return "—";
  }
  const total = Math.floor(Number(seconds));
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function getOutcomeBadge(outcome: string, t: any) {
  switch (outcome) {
    case "connected":
      return {
        label: t("admin.chats.calls.outcomeConnected"),
        cls: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-300",
      };
    case "outgoing":
      return {
        label: t("admin.chats.calls.outcomeOutgoing"),
        cls: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/15 dark:text-sky-300",
      };
    case "cancelled":
      return {
        label: t("admin.chats.calls.outcomeCancelled"),
        cls: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-300",
      };
    case "declined":
      return {
        label: t("admin.chats.calls.outcomeDeclined"),
        cls: "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/15 dark:text-rose-300",
      };
    case "missed":
      return {
        label: t("admin.chats.calls.outcomeMissed"),
        cls: "border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-500/30 dark:bg-orange-500/15 dark:text-orange-300",
      };
    case "failed":
    default:
      return {
        label: t("admin.chats.calls.outcomeFailed"),
        cls: "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/15 dark:text-rose-300",
      };
  }
}

const AdminCallsSubView = forwardRef<any, any>(function AdminCallsSubView(
  { active = true }: any,
  ref,
) {
  const { t } = useI18n();
  const [calls, setCalls] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [initialized, setInitialized] = useState(false);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [outcomeFilter, setOutcomeFilter] = useState("");
  const [sortBy, setSortBy] = useState("created_at");
  const [sortDir, setSortDir] = useState("DESC");
  const debounceRef = useRef<any>(null);
  const requestIdRef = useRef(0);

  const trimmedSearch = search.trim();
  const fetchPage = useCallback(
    async (targetPage: number) => {
      const requestId = ++requestIdRef.current;
      setLoading(true);
      const offset = (Math.max(1, targetPage) - 1) * pageSize;
      const params = new URLSearchParams({
        limit: String(pageSize),
        offset: String(offset),
        sortBy,
        sortDir,
      });
      if (trimmedSearch) params.set("search", trimmedSearch);
      if (typeFilter) params.set("type", typeFilter);
      if (outcomeFilter) params.set("outcome", outcomeFilter);
      try {
        const data = await api.get(`/api/admin/calls?${params.toString()}`);
        if (requestId !== requestIdRef.current) return;
        setCalls(Array.isArray(data?.calls) ? data.calls : []);
        setTotal(Number(data?.total || 0));
        setInitialized(true);
      } catch {
        if (requestId !== requestIdRef.current) return;
        setInitialized(true);
      } finally {
        if (requestId === requestIdRef.current) setLoading(false);
      }
    },
    [trimmedSearch, typeFilter, outcomeFilter, sortBy, sortDir, pageSize],
  );

  useEffect(() => {
    if (!active) return undefined;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchPage(page), 250);
    return () => clearTimeout(debounceRef.current);
  }, [active, page, fetchPage]);

  const refresh = useCallback(() => fetchPage(page), [fetchPage, page]);
  useImperativeHandle(ref, () => ({ refresh }), [refresh]);

  const changeSearch = (value: string) => {
    setSearch(value);
    setPage(1);
  };
  const changeTypeFilter = (value: string) => {
    setTypeFilter(value);
    setPage(1);
  };
  const changeOutcomeFilter = (value: string) => {
    setOutcomeFilter(value);
    setPage(1);
  };
  const changePageSize = (value: number) => {
    setPageSize(value);
    setPage(1);
  };
  const toggleSort = (field: string) => {
    setPage(1);
    setSortBy((prev) => {
      if (prev === field) {
        setSortDir((d) => (d === "DESC" ? "ASC" : "DESC"));
        return field;
      }
      setSortDir("DESC");
      return field;
    });
  };

  const filterSections = [
    {
      id: "callType",
      label: t("admin.chats.calls.colType"),
      value: typeFilter,
      onChange: changeTypeFilter,
      options: [
        ["", t("admin.chats.calls.typeAll")],
        ["voice", t("admin.chats.calls.typeVoice")],
        ["video", t("admin.chats.calls.typeVideo")],
      ],
    },
    {
      id: "callOutcome",
      label: t("admin.chats.calls.colOutcome"),
      value: outcomeFilter,
      onChange: changeOutcomeFilter,
      options: [
        ["", t("admin.chats.calls.outcomeAll")],
        ["connected", t("admin.chats.calls.outcomeConnected")],
        ["outgoing", t("admin.chats.calls.outcomeOutgoing")],
        ["cancelled", t("admin.chats.calls.outcomeCancelled")],
        ["declined", t("admin.chats.calls.outcomeDeclined")],
        ["missed", t("admin.chats.calls.outcomeMissed")],
        ["failed", t("admin.chats.calls.outcomeFailed")],
      ],
    },
  ];

  const resetFilters = () => {
    setTypeFilter("");
    setOutcomeFilter("");
    setPage(1);
  };

  return (
    <div className="space-y-3">
      <TabToolbar>
        <TabSearchInput
          value={search}
          onChange={changeSearch}
          placeholder="admin.chats.calls.search"
        />
        <FilterPopover sections={filterSections} onReset={resetFilters} />
      </TabToolbar>

      {!initialized ? (
        <LoadingRows />
      ) : calls.length === 0 ? (
        <EmptyState message={t("admin.chats.calls.empty")} />
      ) : (
        <>
          {/* Mobile card list */}
          <div className="space-y-2 sm:hidden">
            {calls.map((c) => {
              const callerName = c.caller?.nickname || c.caller?.username || "—";
              const chatLabel = c.participants || c.chatName || c.chatId;
              const outcomeBadge = getOutcomeBadge(c.outcome, t);
              return (
                <div key={c.id} className={"p-3 " + cardCls}>
                  <div className="flex items-start gap-3">
                    <Avatar
                      src={c.caller?.avatarUrl}
                      name={callerName}
                      color={c.caller?.color || "#10b981"}
                      className="h-9 w-9 shrink-0 text-xs font-bold text-white"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="flex items-center gap-0.5 truncate text-sm font-semibold text-slate-700 dark:text-slate-200" dir="ltr">
                          <span className={`truncate ${hasPersian(callerName) ? "font-fa" : ""}`} dir="auto">
                            {callerName}
                          </span>
                          {Boolean(c.caller?.verified) && <VerifiedBadge size={14} />}
                          <UserRoleBadge role={c.caller?.role} size={14} />
                        </p>
                        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${outcomeBadge.cls}`}>
                          {outcomeBadge.label}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400" dir="auto">
                        {chatLabel}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
                        <span className="inline-flex items-center gap-1">
                          {c.callType === "video" ? (
                            <Video size={12} className="text-emerald-500" />
                          ) : (
                            <Phone size={12} className="text-emerald-500" />
                          )}
                          {c.callType === "video"
                            ? t("admin.chats.calls.typeVideo")
                            : t("admin.chats.calls.typeVoice")}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Clock12 size={12} className="text-slate-400" />
                          {formatCallDuration(c.durationSeconds)}
                        </span>
                        {c.chatType === "dm" ? (
                          <ChannelBadge channel={c.chatChannel} size="xs" />
                        ) : null}
                        <span className="text-slate-400">{fmtDate(c.createdAt)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Desktop table */}
          <div className={"hidden overflow-hidden sm:block " + cardCls}>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-100 dark:border-white/5">
                  <tr>
                    <SortTh field="caller" sortBy={sortBy} sortDir={sortDir} onToggle={toggleSort}>
                      {t("admin.chats.calls.colCaller")}
                    </SortTh>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400">
                      {t("admin.chats.calls.colChat")}
                    </th>
                    <SortTh field="type" sortBy={sortBy} sortDir={sortDir} onToggle={toggleSort}>
                      {t("admin.chats.calls.colType")}
                    </SortTh>
                    <SortTh field="outcome" sortBy={sortBy} sortDir={sortDir} onToggle={toggleSort}>
                      {t("admin.chats.calls.colOutcome")}
                    </SortTh>
                    <SortTh field="duration" sortBy={sortBy} sortDir={sortDir} onToggle={toggleSort}>
                      {t("admin.chats.calls.colDuration")}
                    </SortTh>
                    <SortTh field="created_at" sortBy={sortBy} sortDir={sortDir} onToggle={toggleSort}>
                      {t("admin.chats.calls.colTime")}
                    </SortTh>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50 dark:divide-white/4">
                  {calls.map((c) => {
                    const callerName = c.caller?.nickname || c.caller?.username || "—";
                    const chatLabel = c.participants || c.chatName || c.chatId;
                    const outcomeBadge = getOutcomeBadge(c.outcome, t);
                    return (
                      <tr key={c.id} className="hover:bg-emerald-50/30 dark:hover:bg-emerald-500/5">
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2.5">
                            <Avatar
                              src={c.caller?.avatarUrl}
                              name={callerName}
                              color={c.caller?.color || "#10b981"}
                              className="h-7 w-7 shrink-0 text-xs font-bold text-white"
                            />
                            <div className="min-w-0">
                              <p className="flex items-center gap-0.5 truncate text-xs font-semibold text-slate-700 dark:text-slate-200" dir="ltr">
                                <span className={`truncate ${hasPersian(callerName) ? "font-fa" : ""}`} dir="auto">
                                  {callerName}
                                </span>
                                {Boolean(c.caller?.verified) && <VerifiedBadge size={13} />}
                                <UserRoleBadge role={c.caller?.role} size={13} />
                              </p>
                              {c.caller?.username ? (
                                <p className="text-[11px] text-slate-400">@{c.caller.username}</p>
                              ) : null}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-slate-600 dark:text-slate-300">
                          <div className="flex items-center gap-2">
                            <span className={`max-w-[200px] truncate ${hasPersian(chatLabel) ? "font-fa" : ""}`} dir="auto">
                              {chatLabel}
                            </span>
                            {c.chatType === "dm" ? (
                              <ChannelBadge channel={c.chatChannel} size="xs" />
                            ) : null}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-slate-600 dark:text-slate-300">
                          <span className="inline-flex items-center gap-1.5">
                            {c.callType === "video" ? (
                              <Video size={13} className="text-emerald-500" />
                            ) : (
                              <Phone size={13} className="text-emerald-500" />
                            )}
                            {c.callType === "video"
                              ? t("admin.chats.calls.typeVideo")
                              : t("admin.chats.calls.typeVoice")}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-xs">
                          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${outcomeBadge.cls}`}>
                            {outcomeBadge.label}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 font-mono text-xs text-slate-600 dark:text-slate-300">
                          {formatCallDuration(c.durationSeconds)}
                        </td>
                        <td className="px-4 py-2.5 text-[11px] text-slate-400 dark:text-slate-500">
                          {fmtDate(c.createdAt)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <Pagination
            page={page}
            pageSize={pageSize}
            total={total}
            onPageChange={setPage}
            onPageSizeChange={changePageSize}
            busy={loading}
          />
        </>
      )}
    </div>
  );
});

export default AdminCallsSubView;
