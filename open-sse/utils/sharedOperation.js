/** One actual operation, independently cancelable request/background owners. */
export async function joinSharedOperation(map, key, start, { signal } = {}) {
  signal?.throwIfAborted();
  let entry = map.get(key);
  if (!entry || entry.controller.signal.aborted) {
    entry = { controller: new AbortController(), owners: new Set(), startedAt: Date.now() };
    map.set(key, entry);
  }

  const owned = entry;
  const sharedSignal = owned.controller.signal;
  const evict = () => { if (map.get(key) === owned) map.delete(key); };
  const waiter = new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, result, failed = false) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", cancel);
      sharedSignal.removeEventListener("abort", cancelShared);
      owned.owners.delete(finish);
      if (failed) reject(error); else resolve(result);
    };
    const cancel = () => {
      finish(signal.reason, undefined, true);
      if (owned.owners.size === 0) {
        evict();
        owned.controller.abort(signal.reason);
      }
    };
    const cancelShared = () => finish(sharedSignal.reason, undefined, true);
    owned.owners.add(finish);
    signal?.addEventListener("abort", cancel, { once: true });
    sharedSignal.addEventListener("abort", cancelShared, { once: true });
  });

  if (!owned.promise) {
    // Start only after the first owner is registered, including synchronous throws.
    try { owned.promise = Promise.resolve(start(sharedSignal)); }
    catch (error) { owned.promise = Promise.reject(error); }
    owned.promise.then(result => {
      evict();
      if (!sharedSignal.aborted) {
        for (const finish of [...owned.owners]) finish(undefined, result);
      }
    }, error => {
      evict();
      for (const finish of [...owned.owners]) finish(error, undefined, true);
    });
  }
  return waiter;
}

/** Preparation waits share the operation signal, not a first caller's signal. */
export function waitForOperation(ms, signal) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const done = () => { signal?.removeEventListener("abort", abort); resolve(); };
    const timer = setTimeout(done, ms);
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      reject(signal.reason);
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}
