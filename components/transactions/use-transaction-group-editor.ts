import { useEffect, useState, type SubmitEvent } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api/client";
import { confirmDestructiveAction } from "@/lib/confirm-destructive";
import { queryKeys } from "@/lib/query-keys";
import { resolveGroupMembership } from "@/lib/transaction-group-membership";
import { invalidateTransactionGroupViews } from "./transaction-group-data";
import type { TransactionGroup, TransactionGroupDetail } from "./transaction-group-types";

export function useTransactionGroupEditor({ group, workspaceId, workspace, onClose, onDeleted }: {
  group: TransactionGroup;
  workspaceId: string;
  workspace: { name: string; role: string };
  onClose: () => void;
  onDeleted: () => void;
}) {
  const client = useQueryClient();
  const [name, setName] = useState(group.name);
  const [icon, setIcon] = useState(group.icon || "📌");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [changes, setChanges] = useState<Record<string, boolean>>({});
  const [lastMemberIds, setLastMemberIds] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => window.clearTimeout(timeout);
  }, [search]);
  const detail = useQuery({
    queryKey: queryKeys.key(["transaction-group-detail", workspaceId, group.id, debouncedSearch]),
    queryFn: () => {
      const params = new URLSearchParams();
      if (debouncedSearch) params.set("search", debouncedSearch);
      return apiFetch<TransactionGroupDetail>(`/api/transaction-groups/${group.id}?${params}`);
    },
    placeholderData: keepPreviousData,
    staleTime: 0,
  });
  useEffect(() => {
    if (detail.data) setLastMemberIds(detail.data.memberIds);
  }, [detail.data]);
  // Search results contain only matching candidates; memberIds covers the entire group.
  const memberIds = detail.data?.memberIds ?? lastMemberIds;
  const membership = resolveGroupMembership(memberIds, changes);
  const save = useMutation({
    mutationFn: () => apiFetch(`/api/transaction-groups/${group.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), icon, addTransactionIds: membership.addTransactionIds, removeTransactionIds: membership.removeTransactionIds }),
    }),
    onSuccess: () => {
      invalidateTransactionGroupViews(client, workspaceId);
      onClose();
    },
  });
  const remove = useMutation({
    mutationFn: () => apiFetch(`/api/transaction-groups/${group.id}`, { method: "DELETE" }),
    onSuccess: () => {
      invalidateTransactionGroupViews(client, workspaceId);
      onDeleted();
    },
  });
  const busy = save.isPending || remove.isPending || confirming;
  const canSave = !busy && Boolean(detail.data) && !detail.isFetching && !detail.isError && Boolean(name.trim());
  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    if (!canSave) return;
    remove.reset();
    save.mutate();
  };
  const confirmDelete = async () => {
    if (busy) return;
    setConfirming(true);
    const confirmed = await confirmDestructiveAction(`Delete “${group.name}”? Its transactions will remain in the sub-account.`, "Delete transaction group?", {
      workspace,
      reversal: "The group cannot be restored automatically; its transactions are not deleted.",
    });
    setConfirming(false);
    if (!confirmed) return;
    save.reset();
    remove.mutate();
  };
  const toggle = (id: string) => setChanges((current) => ({ ...current, [id]: !(current[id] ?? memberIds.includes(id)) }));
  return { name, setName, icon, setIcon, search, setSearch, detail, membership, busy, canSave, save, remove, submit, confirmDelete, toggle };
}
