import { create } from 'zustand';

/**
 * A receipt shared in from another app, waiting to be opened.
 *
 * It is held here rather than navigated to directly because the drain runs as
 * soon as the database is ready, which is before the auth gate has decided
 * where the user belongs. A push at that moment is wiped by the
 * `router.replace` that follows, and the receipt is lost — the queue file has
 * already been consumed by then.
 *
 * So the drain parks it here, and RootLayoutNav opens it once the redirect has
 * settled and there is a stable screen to come back to.
 */
interface SharedReceiptState {
  uri: string | null;
  setUri: (uri: string | null) => void;
}

export const useSharedReceiptStore = create<SharedReceiptState>((set) => ({
  uri: null,
  setUri: (uri) => set({ uri }),
}));
