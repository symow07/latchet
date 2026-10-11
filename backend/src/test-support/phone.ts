/**
 * The phone's real sync core, loaded into the backend's test runner.
 *
 * Everything here is the app's own code from mobile/src, unchanged: the
 * per-user schema and its seed (local-schema.ts), the sync engine (pure), its
 * SQLite store, the wire protocol, the push redaction, the bun:sqlite
 * stand-in for expo-sqlite that the phone's own tests use (test-sqlite.ts),
 * and from the Phase 4 screens' logic (lib/offline) the pieces that import
 * nothing: run-now's orchestration, a bill's paid toggle and the net-worth
 * breakdown's codec.
 * These modules were written to import nothing native for exactly this use;
 * db.ts is not among them (it imports expo-sqlite and the i18n stack), which
 * is why phone-writes.ts mirrors its writes instead.
 *
 * One file holds the cross-tree path, so a move on the phone side breaks here
 * and nowhere else. Imported only by tests.
 */
export {
  createSyncEngine,
  type SyncEngine,
  type SyncReport,
} from "../../../mobile/src/lib/sync/engine";
export {
  SYNC_META,
  createSqliteSyncStore,
  type SyncDbAccess,
  type SyncSqlDb,
} from "../../../mobile/src/lib/sync/sqlite-store";
export { openTestUserDatabase } from "../../../mobile/src/lib/sync/test-sqlite";
export {
  SyncTransportError,
  entityFields,
  type PullResponse,
  type PushRequest,
  type PushResponse,
  type PushStatus,
  type SyncTransport,
} from "../../../mobile/src/lib/sync/protocol";
export {
  EPOCH_ISO,
  LOCAL_SYNC_TABLES,
  SETTINGS_SYNC_ID,
  SYNC_ENTITIES,
  defaultAccountId,
  type SyncEntity,
} from "../../../mobile/src/lib/local-schema";
export { redactDeviceOnly } from "../../../mobile/src/lib/sync-redaction";
export {
  runRecurringNow,
  type LocalSyncState,
  type RunNowDeps,
  type RunNowOutcome,
} from "../../../mobile/src/lib/offline/recurring";
export { billPaidChange } from "../../../mobile/src/lib/offline/bills";
export { parseBreakdown, serializeBreakdown, type Breakdown } from "../../../mobile/src/lib/offline/breakdown";
