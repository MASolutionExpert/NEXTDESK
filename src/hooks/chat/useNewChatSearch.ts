'use client';

import { useEffect, useState } from "react";

export function normalizeUserSearchQuery(raw: any): string {
  return String(raw || "").trim().replace(/^@+/, "").trim().toLowerCase();
}

export function useNewChatSearch({
  user,
  searchUsers,
  debounceMs,
  maxResults,
}: any) {
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [newChatUsername, setNewChatUsername] = useState("");
  const [newChatError, setNewChatError] = useState("");
  const [newChatResults, setNewChatResults] = useState<any>([]);
  const [newChatLoading, setNewChatLoading] = useState(false);
  const [newChatSelection, setNewChatSelection] = useState<any>(null);

  useEffect(() => {
    if (!newChatOpen) return;
    const cleaned = normalizeUserSearchQuery(newChatUsername);
    if (!cleaned) {
      setNewChatResults([]);
      setNewChatSelection(null);
      return;
    }

    const handle = setTimeout(async () => {
      try {
        setNewChatLoading(true);
        const res = await searchUsers({
          exclude: user.username,
          query: cleaned,
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data?.error || "Unable to search users.");
        }
        const users = (data.users || []).slice(0, maxResults);
        setNewChatResults(users);
      } catch (err: any) {
        setNewChatError(err?.message || "Unable to search users.");
      } finally {
        setNewChatLoading(false);
      }
    }, debounceMs);

    return () => clearTimeout(handle);
  }, [
    debounceMs,
    maxResults,
    newChatOpen,
    newChatUsername,
    searchUsers,
    user.username,
  ]);

  return {
    newChatOpen,
    setNewChatOpen,
    newChatUsername,
    setNewChatUsername,
    newChatError,
    setNewChatError,
    newChatResults,
    setNewChatResults,
    newChatLoading,
    newChatSelection,
    setNewChatSelection,
  };
}
