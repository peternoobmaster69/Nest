export function resolveGroupMembership(memberIds: readonly string[], changes: Readonly<Record<string, boolean>>) {
  const selectedIds = new Set(memberIds);
  const addTransactionIds: string[] = [];
  const removeTransactionIds: string[] = [];
  for (const [id, selected] of Object.entries(changes)) {
    if (selected === selectedIds.has(id)) continue;
    if (selected) {
      selectedIds.add(id);
      addTransactionIds.push(id);
    } else {
      selectedIds.delete(id);
      removeTransactionIds.push(id);
    }
  }
  return { selectedIds, addTransactionIds, removeTransactionIds };
}
