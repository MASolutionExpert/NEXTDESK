'use client';

import Tooltip from "./Tooltip.tsx";
import { useI18n } from "../../i18n/index.ts";

export interface ChannelBadgeProps {
  channel?: string | null;
  departmentName?: string | null;
  size?: "xs" | "sm";
  className?: string;
}

/**
 * Clean LTR-pinned channel pill distinguishing support tickets ("SUPPORT", rose)
 * from messenger direct chats ("MESSENGER", slate).
 */
export default function ChannelBadge({
  channel,
  departmentName = null,
  size = "xs",
  className = "",
}: ChannelBadgeProps) {
  const { t } = useI18n();
  const normalized = String(channel || "direct").toLowerCase();
  const isSupport = normalized === "support";

  const pillText = isSupport ? "SUPPORT" : "MESSENGER";
  const tooltipLabel = isSupport
    ? departmentName
      ? t("chat.channel.supportTooltipDept", { department: departmentName })
      : t("chat.channel.supportTooltip")
    : t("chat.channel.messengerTooltip");

  const sizeCls =
    size === "sm"
      ? "px-1.5 py-0.5 text-[10px] leading-none"
      : "px-1.5 py-[2px] text-[9px] leading-none";

  const toneCls = isSupport
    ? "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/35 dark:bg-rose-500/15 dark:text-rose-200"
    : "border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-600/50 dark:bg-slate-800/80 dark:text-slate-300";

  return (
    <Tooltip label={tooltipLabel} placement="top" asChild>
      <span
        dir="ltr"
        data-channel-badge={isSupport ? "support" : "direct"}
        className={`inline-flex shrink-0 items-center rounded-full border font-bold tracking-wider uppercase select-none ${sizeCls} ${toneCls} ${className}`}
      >
        {pillText}
      </span>
    </Tooltip>
  );
}
