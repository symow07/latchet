import React from 'react';

const noSubscription = () => () => {};

// The server snapshot is what server rendering and hydration see; the client
// one is what every render after them sees.
export function useClientOnlyValue<S, C>(server: S, client: C): S | C {
  return React.useSyncExternalStore<S | C>(
    noSubscription,
    () => client,
    () => server,
  );
}
