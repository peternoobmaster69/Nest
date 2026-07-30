export function withoutWorkspaceScope<T extends { workspaceId: unknown }>(record: T) {
  const { workspaceId: _workspaceId, ...publicRecord } = record;
  return publicRecord;
}

export function withoutPolicyScope<T extends { workspaceId: unknown; policyId: unknown }>(record: T) {
  const { workspaceId: _workspaceId, policyId: _policyId, ...publicRecord } = record;
  return publicRecord;
}

export function withoutExposureStorageKey<
  T extends { workspaceId: unknown; exposureKey: unknown },
>(record: T) {
  const {
    workspaceId: _workspaceId,
    exposureKey: _exposureKey,
    ...publicRecord
  } = record;
  return { ...publicRecord, key: _exposureKey };
}
