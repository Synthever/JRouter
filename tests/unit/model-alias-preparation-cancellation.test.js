import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter, getEventListeners } from "node:events";
import { PassThrough } from "node:stream";

const target = "https://api.example.test/v1/chat";
const proxy = { enabled: true, url: "http://proxy.test:3128" };
const mitmTarget = "https://api2.cursor.sh/fixture";
function deferred() {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
}
const turn = () => new Promise(resolve => setImmediate(resolve));

async function load(fetch) {
  vi.resetModules();
  vi.stubGlobal("fetch", fetch);
  return (await import("../../open-sse/utils/proxyFetch.js")).proxyAwareFetch;
}

beforeEach(() => {
  for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "all_proxy", "no_proxy", "STRICT_SSL"]) vi.stubEnv(key, "");
  vi.doMock("undici", () => ({
    Agent: class { constructor(options) { this.options = options; } },
    ProxyAgent: class { constructor(options) { this.options = options; } },
  }));
});
afterEach(() => {
  for (const name of ["undici", "dns", "node:dns/promises", "net", "https"]) vi.doUnmock(name);
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function manualFixture() {
  let connected = deferred();
  const requested = deferred();
  let socket, req, respond;
  const resolve4 = vi.fn((_host, cb) => cb(null, ["192.0.2.1"]));
  vi.doMock("dns", () => ({ Resolver: class { setServers() {} resolve4(...args) { resolve4(...args); } } }));
  class Socket extends EventEmitter {
    constructor() { super(); socket = this; this.destroy = vi.fn(() => { this.destroyed = true; }); }
    connect = vi.fn((_port, _ip, callback) => { this.lateConnect = callback; connected.resolve(); });
  }
  const dispatch = vi.fn((_options, callback) => {
    respond = callback;
    req = new EventEmitter();
    req.write = vi.fn();
    req.end = vi.fn();
    req.destroy = vi.fn(() => { req.destroyed = true; });
    requested.resolve();
    return req;
  });
  vi.doMock("net", () => ({ default: { Socket } }));
  vi.doMock("https", () => ({ default: { request: dispatch } }));
  return {
    get connected() { return connected; }, requested, dispatch, resolve4,
    resetConnect() { connected = deferred(); },
    get socket() { return socket; }, get req() { return req; },
    headers(res = new PassThrough()) {
      res.statusCode = 201; res.statusMessage = "Created"; res.headers = { "x-fixture": "manual" };
      vi.spyOn(res, "destroy");
      respond(res);
      return res;
    },
  };
}

describe("manual body ownership", () => {
  async function responseFixture() {
    const fixture = manualFixture(), owner = new AbortController();
    const fetch = vi.fn(async () => new Response("unexpected fallback"));
    const request = await load(fetch);
    const work = request(mitmTarget, { signal: owner.signal });
    await fixture.connected.promise;
    fixture.socket.lateConnect();
    await fixture.requested.promise;
    const res = fixture.headers();
    return { fixture, owner, fetch, res, response: await work };
  }

  it("keeps cancellation ownership after headers and rejects a pending reader without waiting for destroy", async () => {
    const { fixture, owner, fetch, res, response } = await responseFixture();
    expect(getEventListeners(owner.signal, "abort")).toHaveLength(1);
    // An uncooperative destroy must not hold the consumer's cancellation.
    res.destroy.mockImplementation(() => res);
    const reader = response.body.getReader();
    let settled = false;
    const read = reader.read().catch(error => { settled = true; return error; });
    owner.abort(new Error("body canceled"));
    await turn();
    expect(settled).toBe(true);
    expect(await read).toBe(owner.signal.reason);
    expect(res.destroy).toHaveBeenCalled();
    expect(fixture.req.destroy).toHaveBeenCalled();
    expect(fixture.socket.destroy).toHaveBeenCalled();
    expect(getEventListeners(owner.signal, "abort")).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
    reader.releaseLock();
    res.destroy.mockRestore();
    res.destroy();
  });

  it("body reader cancel releases all transport and listeners promptly", async () => {
    const { fixture, owner, res, response } = await responseFixture();
    const reader = response.body.getReader();
    await reader.cancel("consumer left");
    expect(res.destroy).toHaveBeenCalled();
    expect(fixture.req.destroy).toHaveBeenCalled();
    expect(fixture.socket.destroy).toHaveBeenCalled();
    expect(getEventListeners(owner.signal, "abort")).toHaveLength(0);
    reader.releaseLock();
  });

  it.each(["text", "json"])("normal %s body EOF preserves response conventions and releases ownership", async (method) => {
    const { fixture, owner, res, response } = await responseFixture();
    expect(response.ok).toBe(true);
    expect(response.status).toBe(201);
    expect(response.statusText).toBe("Created");
    expect(response.headers.get("x-fixture")).toBe("manual");
    const body = response[method]();
    res.end(Buffer.from('{"fixture":true}'));
    expect(await body).toEqual(method === "json" ? { fixture: true } : '{"fixture":true}');
    expect(fixture.req.destroy).toHaveBeenCalled();
    expect(fixture.socket.destroy).toHaveBeenCalled();
    expect(getEventListeners(owner.signal, "abort")).toHaveLength(0);
  });

  it("body errors reject the reader and release remaining transport without replay", async () => {
    const { fixture, owner, fetch, res, response } = await responseFixture();
    const error = new Error("body response lost");
    const read = response.body.getReader().read().catch(e => e);
    res.destroy(error);
    expect(await read).toBe(error);
    expect(fixture.req.destroy).toHaveBeenCalled();
    expect(fixture.socket.destroy).toHaveBeenCalled();
    expect(getEventListeners(owner.signal, "abort")).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("manual bypass transport", () => {
  it("successful DNS retains its configured TTL while normal manual readers release sockets", async () => {
    const fixture = manualFixture();
    const fetch = vi.fn(async () => new Response("unexpected"));
    const request = await load(fetch);
    const { MEMORY_CONFIG } = await import("../../open-sse/config/runtimeConfig.js");
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    async function run() {
      fixture.resetConnect();
      const work = request(mitmTarget);
      await fixture.connected.promise;
      fixture.socket.lateConnect();
      const res = fixture.headers();
      const response = await work;
      const reader = response.body.getReader();
      const first = reader.read();
      res.write(Buffer.from("one"));
      expect(Buffer.from((await first).value).toString()).toBe("one");
      const second = reader.read();
      res.end(Buffer.from("two"));
      expect(Buffer.from((await second).value).toString()).toBe("two");
      expect((await reader.read()).done).toBe(true);
      reader.releaseLock();
      expect(fixture.socket.destroy).toHaveBeenCalled();
      expect(fixture.req.destroy).toHaveBeenCalled();
    }
    await run();
    clock.mockReturnValue(now + MEMORY_CONFIG.dnsCacheTtlMs - 1);
    await run();
    expect(fixture.resolve4).toHaveBeenCalledTimes(1);
    clock.mockReturnValue(now + MEMORY_CONFIG.dnsCacheTtlMs + 1);
    await run();
    expect(fixture.resolve4).toHaveBeenCalledTimes(2);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("abort while writing the request prevents end and destroys the request", async () => {
    const fixture = manualFixture(), owner = new AbortController();
    fixture.dispatch.mockImplementationOnce((_options) => {
      const req = new EventEmitter();
      req.destroy = vi.fn();
      req.write = vi.fn(() => owner.abort(new Error("write canceled")));
      req.end = vi.fn();
      return req;
    });
    const fetch = vi.fn(async () => new Response("unexpected"));
    const request = await load(fetch);
    const result = request(mitmTarget, { signal: owner.signal, body: "fixture" }).catch(error => error);
    await fixture.connected.promise;
    fixture.socket.lateConnect();
    const req = fixture.dispatch.mock.results[0].value;
    expect(await result).toBe(owner.signal.reason);
    expect(req.write).toHaveBeenCalledTimes(1);
    expect(req.end).not.toHaveBeenCalled();
    expect(req.destroy).toHaveBeenCalled();
    expect(getEventListeners(owner.signal, "abort")).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["connect", "headers"])("abort during %s releases owned transport and prevents late dispatch", async (phase) => {
    const fixture = manualFixture(), owner = new AbortController();
    const fetch = vi.fn(async () => new Response("unexpected fallback"));
    const request = await load(fetch);
    let settled = false;
    const result = request(mitmTarget, { signal: owner.signal, body: "fixture" }).catch(error => { settled = true; return error; });
    await fixture.connected.promise;
    if (phase === "headers") { fixture.socket.lateConnect(); await fixture.requested.promise; }
    owner.abort(new Error("manual canceled"));
    await turn();
    expect(settled).toBe(true);
    expect(await result).toBe(owner.signal.reason);
    expect(fixture.socket.destroy).toHaveBeenCalledTimes(1);
    expect(getEventListeners(owner.signal, "abort")).toHaveLength(0);
    if (phase === "connect") {
      fixture.socket.lateConnect();
      expect(fixture.dispatch).not.toHaveBeenCalled();
    } else {
      expect(fixture.req.destroy).toHaveBeenCalledTimes(1);
      const late = fixture.headers();
      expect(late.destroy).toHaveBeenCalled();
      expect(fixture.req.write).toHaveBeenCalledTimes(1);
      expect(fixture.req.end).toHaveBeenCalledTimes(1);
    }
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([false, true])("manual response loss with replay allowance=%s", async (allowNetworkReplay) => {
    const fixture = manualFixture();
    const fetch = vi.fn(async () => new Response("native fallback"));
    const request = await load(fetch);
    const error = new Error("manual response lost");
    const result = request(mitmTarget, {}, null, { allowNetworkReplay }).catch(e => e);
    await fixture.connected.promise;
    fixture.socket.lateConnect();
    await fixture.requested.promise;
    fixture.req.emit("error", error);
    if (allowNetworkReplay) expect(await result).toBeInstanceOf(Response);
    else expect(await result).toBe(error);
    expect(fixture.dispatch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(allowNetworkReplay ? 1 : 0);
  });
});

describe("setup cancellation", () => {
  it.each(["relay", "insecure retry"])("%s cancellation preserves the signal reason when native transport masks it", async (path) => {
    const owner = new AbortController();
    const certError = Object.assign(new Error("certificate failed"), { code: "CERT_HAS_EXPIRED" });
    const fetch = vi.fn(async () => { owner.abort(new Error("original transport cancel")); throw new TypeError("masked cancel"); });
    if (path === "insecure retry") fetch.mockRejectedValueOnce(certError);
    const request = await load(fetch);
    const result = await request(target, { signal: owner.signal }, path === "relay" ? { vercelRelayUrl: "https://relay.test" } : null).catch(error => error);
    expect(result).toBe(owner.signal.reason);
    expect(owner.signal.aborted).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(path === "relay" ? 1 : 2);
  });
  it("preserves a null cancellation reason without substituting AbortError", async () => {
    const owner = new AbortController();
    owner.abort(null);
    const fetch = vi.fn(async () => new Response("unexpected"));
    const request = await load(fetch);
    await expect(request(target, { signal: owner.signal })).rejects.toBe(null);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses an unresolved intended strict proxy before MITM DNS or manual transport", async () => {
    const fixture = manualFixture();
    const fetch = vi.fn(async () => new Response("unexpected"));
    const request = await load(fetch);
    let settled = false;
    const result = request(mitmTarget, {}, { proxyPoolId: "unresolved", strictProxy: true }).catch(error => { settled = true; return error; });
    await turn();
    expect(settled).toBe(true);
    expect(await result).toMatchObject({ message: expect.stringContaining("strictProxy") });
    expect(fixture.resolve4).not.toHaveBeenCalled();
    expect(fixture.dispatch).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["direct", "proxy", "relay", "manual"])("pre-aborted %s request performs no setup or dispatch", async (path) => {
    const owner = new AbortController();
    owner.abort(new Error("already canceled"));
    const resolve4 = vi.fn((_host, cb) => cb(null, ["192.0.2.1"]));
    const socket = vi.fn(() => { throw new Error("unexpected socket"); });
    const dispatcher = vi.fn();
    vi.doMock("dns", () => ({ Resolver: class { setServers() {} resolve4(...args) { resolve4(...args); } } }));
    vi.doMock("net", () => ({ default: { Socket: class { constructor() { socket(); } } } }));
    vi.doMock("undici", () => ({ Agent: dispatcher, ProxyAgent: dispatcher }));
    const fetch = vi.fn(async () => new Response("unexpected"));
    const request = await load(fetch);
    const proxyOptions = path === "proxy" ? proxy : path === "relay" ? { vercelRelayUrl: "https://relay.test" } : null;
    await expect(request(path === "manual" ? mitmTarget : target, { signal: owner.signal }, proxyOptions)).rejects.toBe(owner.signal.reason);
    expect(fetch).not.toHaveBeenCalled();
    expect(resolve4).not.toHaveBeenCalled();
    expect(socket).not.toHaveBeenCalled();
    expect(dispatcher).not.toHaveBeenCalled();
  });

  it("never retries or wraps a cancellation after proxy dispatch", async () => {
    const owner = new AbortController();
    const fetch = vi.fn(async () => { owner.abort("original cancellation"); throw new TypeError("fetch failed"); });
    const request = await load(fetch);
    await expect(request(target, { signal: owner.signal }, { ...proxy, strictProxy: true })).rejects.toBe("original cancellation");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("detaches a canceled DNS waiter promptly without publishing its late result", async () => {
    const started = deferred();
    let callback;
    const resolve4 = vi.fn((_host, cb) => { callback = cb; started.resolve(); });
    const socket = vi.fn(() => { throw new Error("unexpected socket"); });
    vi.doMock("dns", () => ({ Resolver: class { setServers() {} resolve4(...args) { resolve4(...args); } } }));
    vi.doMock("net", () => ({ default: { Socket: class { constructor() { socket(); } } } }));
    const owner = new AbortController();
    const remove = vi.spyOn(owner.signal, "removeEventListener");
    const fetch = vi.fn(async () => new Response("fallback"));
    const request = await load(fetch);
    let settled = false;
    const result = request(mitmTarget, { signal: owner.signal }).catch(error => { settled = true; return error; });
    await started.promise;
    owner.abort(new Error("DNS canceled"));
    await turn();
    expect(settled).toBe(true);
    expect(await result).toBe(owner.signal.reason);
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    callback(null, ["192.0.2.1"]);
    await turn();
    expect(socket).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    const fresh = request(mitmTarget);
    await turn();
    expect(resolve4).toHaveBeenCalledTimes(2);
    callback(new Error("ordinary DNS failure"));
    await fresh;
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("cancels a dispatcher import waiter and does not create a late dispatcher or fetch", async () => {
    const started = deferred(), imported = deferred();
    const constructor = vi.fn();
    vi.doUnmock("undici");
    vi.doMock("undici", async () => { started.resolve(); await imported.promise; return { Agent: constructor, ProxyAgent: constructor }; });
    const owner = new AbortController();
    const fetch = vi.fn(async () => new Response("unexpected"));
    const request = await load(fetch);
    let settled = false;
    const result = request(target, { signal: owner.signal }, proxy).catch(error => { settled = true; return error; });
    await started.promise;
    owner.abort(new Error("dispatcher canceled"));
    await turn();
    expect(settled).toBe(true);
    expect(await result).toBe(owner.signal.reason);
    imported.resolve();
    await turn();
    expect(constructor).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("relay retains the caller signal and remains a single cancelable dispatch", async () => {
    const owner = new AbortController(), started = deferred();
    const fetch = vi.fn((_url, options) => { started.resolve(options); return new Promise((resolve, reject) => options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true })); });
    const request = await load(fetch);
    const result = request(target, { signal: owner.signal }, { vercelRelayUrl: "https://relay.test" }, { allowNetworkReplay: false }).catch(error => error);
    expect((await started.promise).signal).toBe(owner.signal);
    owner.abort();
    expect(await result).toBe(owner.signal.reason);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("server-owned network replay control", () => {
  it("ordinary pre-dispatch DNS failure still allows one native dispatch with replay disabled", async () => {
    const resolve4 = vi.fn((_host, cb) => cb(new Error("DNS unavailable")));
    vi.doMock("dns", () => ({ Resolver: class { setServers() {} resolve4(...args) { resolve4(...args); } } }));
    const fetch = vi.fn(async () => new Response("native"));
    const request = await load(fetch);
    await expect(request(mitmTarget, {}, null, { allowNetworkReplay: false })).resolves.toBeInstanceOf(Response);
    expect(resolve4).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("STRICT_SSL retains secure-only native behavior", async () => {
    vi.stubEnv("STRICT_SSL", "true");
    const error = Object.assign(new Error("certificate failed"), { code: "CERT_HAS_EXPIRED" });
    const fetch = vi.fn().mockRejectedValue(error);
    const request = await load(fetch);
    await expect(request(target)).rejects.toBe(error);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])("strict proxy failure stays on proxy with replay allowance=%s", async (allowNetworkReplay) => {
    const error = new Error("proxy failed");
    const fetch = vi.fn().mockRejectedValue(error);
    const request = await load(fetch);
    const result = request(target, {}, { ...proxy, strictProxy: true }, { allowNetworkReplay });
    if (allowNetworkReplay) await expect(result).rejects.toThrow("strictProxy");
    else await expect(result).rejects.toBe(error);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("retains the default proxy-to-direct fallback and ignores request-controlled flags", async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new Error("response lost")).mockResolvedValue(new Response("fallback"));
    const request = await load(fetch);
    await expect(request(target, { allowNetworkReplay: false, headers: { allowNetworkReplay: "false" }, body: '{"allowNetworkReplay":false}' }, proxy)).resolves.toBeInstanceOf(Response);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0][1].dispatcher).toBeDefined();
    expect(fetch.mock.calls[1][1].dispatcher).toBeUndefined();
  });

  it("does not replay a MITM-host proxy failure through DNS/manual bypass", async () => {
    const error = new TypeError("proxy response lost");
    const resolve4 = vi.fn((_host, cb) => cb(null, ["192.0.2.1"]));
    vi.doMock("dns", () => ({ Resolver: class { setServers() {} resolve4(...args) { resolve4(...args); } } }));
    vi.doMock("net", () => ({ default: { Socket: class { constructor() { throw new Error("blocked fixture socket"); } } } }));
    const fetch = vi.fn().mockRejectedValueOnce(error).mockResolvedValue(new Response("fallback"));
    const request = await load(fetch);
    await expect(request("https://api2.cursor.sh/fixture", {}, proxy, { allowNetworkReplay: false })).rejects.toBe(error);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(resolve4).not.toHaveBeenCalled();
    vi.doUnmock("dns");
  });

  it.each([false, true])("TLS replay allowance=%s controls the second insecure dispatch", async (allowNetworkReplay) => {
    const error = Object.assign(new TypeError("certificate failed"), { cause: { code: "SELF_SIGNED_CERT_IN_CHAIN" } });
    const fetch = vi.fn().mockRejectedValueOnce(error).mockResolvedValue(new Response("insecure"));
    const request = await load(fetch);
    const work = request(target, {}, null, { allowNetworkReplay });
    if (allowNetworkReplay) {
      await expect(work).resolves.toBeInstanceOf(Response);
      expect(fetch.mock.calls[1][1].dispatcher.options.connect).toEqual({ rejectUnauthorized: false });
    } else await expect(work).rejects.toBe(error);
    expect(fetch).toHaveBeenCalledTimes(allowNetworkReplay ? 2 : 1);
  });
  it("preserves the original response-loss error with one proxy dispatch when replay is disabled", async () => {
    const error = new TypeError("response lost after acceptance");
    const fetch = vi.fn().mockRejectedValueOnce(error).mockResolvedValue(new Response("fallback"));
    const request = await load(fetch);
    await expect(request(target, { method: "POST", body: "fixture" }, proxy, { allowNetworkReplay: false })).rejects.toBe(error);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][1].dispatcher).toBeDefined();
  });
});

// Task5B2a cancellation coverage: these fixtures stub only DNS, fetch, Agent,
// and response readers; they never open sockets or contact remote services.
function bounded(promise, ms = 150) {
  let timer;
  return Promise.race([
    promise,
    new Promise(resolve => { timer = setTimeout(() => resolve(Symbol.for("timeout")), ms); }),
  ]).finally(() => clearTimeout(timer));
}

async function loadImage({ lookup, Agent }) {
  vi.resetModules();
  // Flush the outer hook's queued mock before registering this fixture's Agent.
  vi.doUnmock("undici");
  vi.doMock("node:dns/promises", () => ({ lookup }));
  vi.doMock("undici", () => ({ Agent }));
  return (await import("../../open-sse/translator/concerns/image.js")).fetchImageAsBase64;
}

describe("Task5B2a image and Headroom cancellation", () => {
  it("pre-aborted image fetch performs no DNS, Agent, or fetch work and preserves a null reason", async () => {
    const lookup = vi.fn();
    const Agent = vi.fn();
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const fetchImageAsBase64 = await loadImage({ lookup, Agent });
    const owner = new AbortController();
    owner.abort(null);
    await expect(fetchImageAsBase64("https://images.example.test/a.png", { signal: owner.signal })).rejects.toBe(null);
    expect(lookup).not.toHaveBeenCalled();
    expect(Agent).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("cancels a pending image DNS waiter promptly and ignores its late result", async () => {
    const dns = deferred();
    const started = deferred();
    const lookup = vi.fn(() => { started.resolve(); return dns.promise; });
    const Agent = vi.fn();
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const fetchImageAsBase64 = await loadImage({ lookup, Agent });
    const owner = new AbortController();
    const reason = new Error("image DNS canceled");
    const work = fetchImageAsBase64("https://images.example.test/a.png", { signal: owner.signal }).catch(error => error);
    await started.promise;
    owner.abort(reason);
    expect(await bounded(work)).toBe(reason);
    dns.resolve([{ address: "93.184.216.34", family: 4 }]);
    await turn();
    expect(Agent).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("aborting an image reader releases its Agent without waiting for reader cancellation", async () => {
    const owner = new AbortController();
    const lookup = vi.fn().mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    const close = vi.fn(() => new Promise(() => {}));
    const dispatcher = { close };
    const Agent = vi.fn(function () { this.close = close; });
    const started = deferred();
    const reading = deferred();
    const read = deferred();
    const cancel = vi.fn(() => new Promise(() => {}));
    const releaseLock = vi.fn();
    const fetch = vi.fn(async () => {
      started.resolve();
      return {
        ok: true,
        body: { getReader: () => ({ read: () => { reading.resolve(); return read.promise; }, cancel, releaseLock }) },
      };
    });
    const fetchImageAsBase64 = await loadImage({ lookup, Agent });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(fetch);
    const reason = new Error("image body canceled");
    const work = fetchImageAsBase64("https://images.example.test/a.png", { signal: owner.signal }).catch(error => error);
    await reading.promise;
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    expect(fetchSpy.mock.calls[0][1].signal).not.toBe(owner.signal);
    owner.abort(reason);
    expect(await bounded(work)).toBe(reason);
    expect(cancel).toHaveBeenCalled();
    expect(releaseLock).toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
  });

  it("cancellation after the first prefetched image prevents its mutation and the next lookup", async () => {
    const owner = new AbortController();
    const reason = new Error("stop image prefetch");
    const lookup = vi.fn().mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    const Agent = vi.fn(function () { this.close = vi.fn().mockResolvedValue(); });
    const cancel = vi.fn().mockResolvedValue();
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const fetch = vi.fn(async () => ({
      ok: true,
      body: { getReader: () => ({
        read: () => { owner.abort(reason); return Promise.resolve({ done: false, value: png }); },
        cancel,
        releaseLock: vi.fn(),
      }) },
    }));
    vi.stubGlobal("fetch", fetch);
    const fetchImageAsBase64 = await loadImage({ lookup, Agent });
    const { prefetchRemoteImages } = await import("../../open-sse/translator/concerns/prefetch.js");
    const body = { messages: [{ role: "user", content: [
      { type: "image_url", image_url: { url: "https://images.example.test/one.png" } },
      { type: "image_url", image_url: { url: "https://images.example.test/two.png" } },
    ] }] };
    const original = structuredClone(body);
    const work = prefetchRemoteImages(body, "openai", "gemini", { signal: owner.signal }).catch(error => error);
    expect(await bounded(work)).toBe(reason);
    expect(body).toEqual(original);
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalled();
    expect(fetchImageAsBase64).toBeTypeOf("function");
  });

  it("passes cancellation to Headroom fetch and propagates the caller reason without body mutation", async () => {
    vi.resetModules();
    const { compressWithHeadroom } = await import("../../open-sse/rtk/headroom.js");
    const owner = new AbortController();
    const reason = new Error("Headroom canceled");
    let receivedSignal;
    const fetch = vi.fn((_url, options) => {
      receivedSignal = options.signal;
      return new Promise((resolve, reject) => options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true }));
    });
    vi.stubGlobal("fetch", fetch);
    const body = { messages: [{ role: "user", content: "original" }] };
    const diagnostics = {};
    const work = compressWithHeadroom(body, { enabled: true, url: "http://headroom.test", signal: owner.signal, diagnostics }).catch(error => error);
    await turn();
    expect(receivedSignal).toBeDefined();
    expect(receivedSignal).not.toBe(owner.signal);
    owner.abort(reason);
    expect(await bounded(work)).toBe(reason);
    expect(receivedSignal.aborted).toBe(true);
    expect(body.messages[0].content).toBe("original");
    expect(diagnostics.reason).toBeUndefined();
  });

  it("cancels and releases a pending Headroom response reader without applying partial output", async () => {
    vi.resetModules();
    const { compressWithHeadroom } = await import("../../open-sse/rtk/headroom.js");
    const owner = new AbortController();
    const reason = new Error("Headroom response canceled");
    const read = deferred();
    const cancel = vi.fn(() => new Promise(() => {}));
    const releaseLock = vi.fn();
    const fetch = vi.fn(async (_url, options) => {
      expect(options.signal).toBeDefined();
      return { ok: true, status: 200, body: { getReader: () => ({ read: () => read.promise, cancel, releaseLock }) } };
    });
    vi.stubGlobal("fetch", fetch);
    const body = { messages: [{ role: "user", content: "original" }] };
    const work = compressWithHeadroom(body, { enabled: true, url: "http://headroom.test", signal: owner.signal }).catch(error => error);
    await turn();
    owner.abort(reason);
    expect(await bounded(work)).toBe(reason);
    expect(cancel).toHaveBeenCalled();
    expect(releaseLock).toHaveBeenCalled();
    expect(body.messages[0].content).toBe("original");
  });

  it("preserves null Headroom abort reasons instead of failing open", async () => {
    vi.resetModules();
    const { compressWithHeadroom } = await import("../../open-sse/rtk/headroom.js");
    const owner = new AbortController();
    owner.abort(null);
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(compressWithHeadroom({ messages: [] }, {
      enabled: true, url: "http://headroom.test", signal: owner.signal,
    })).rejects.toBe(null);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("ordinary image failures leave the failed reference alone and continue to the next image", async () => {
    const lookup = vi.fn().mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    const Agent = vi.fn(function () { this.close = vi.fn().mockResolvedValue(); });
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const fetch = vi.fn()
      .mockResolvedValueOnce({ ok: false, body: null })
      .mockResolvedValueOnce({ ok: true, body: { getReader: () => {
        let sent = false;
        return { read: async () => sent ? { done: true } : (sent = true, { done: false, value: png }), cancel: vi.fn(), releaseLock: vi.fn() };
      } } });
    vi.stubGlobal("fetch", fetch);
    await loadImage({ lookup, Agent });
    const { prefetchRemoteImages } = await import("../../open-sse/translator/concerns/prefetch.js");
    const body = { messages: [{ role: "user", content: [
      { type: "image_url", image_url: { url: "https://images.example.test/fail.png" } },
      { type: "image_url", image_url: { url: "https://images.example.test/good.png" } },
    ] }] };
    expect(await prefetchRemoteImages(body, "openai", "gemini")).toBe(1);
    expect(body.messages[0].content[0].image_url.url).toBe("https://images.example.test/fail.png");
    expect(body.messages[0].content[1].image_url.url).toMatch(/^data:image\/png;base64,/);
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("timeout and ordinary Headroom upstream errors stay fail-open", async () => {
    vi.resetModules();
    const { compressWithHeadroom } = await import("../../open-sse/rtk/headroom.js");
    const timeoutFetch = vi.fn((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
    }));
    vi.stubGlobal("fetch", timeoutFetch);
    const timeoutBody = { messages: [{ role: "user", content: "original" }] };
    expect(await compressWithHeadroom(timeoutBody, { enabled: true, url: "http://headroom.test", timeoutMs: 1 })).toBeNull();
    expect(timeoutBody.messages[0].content).toBe("original");

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("upstream unavailable")));
    const errorBody = { messages: [{ role: "user", content: "original" }] };
    const diagnostics = {};
    expect(await compressWithHeadroom(errorBody, { enabled: true, url: "http://headroom.test", diagnostics })).toBeNull();
    expect(errorBody.messages[0].content).toBe("original");
    expect(diagnostics.reason).toContain("request failed:");
  });

  it("normal Claude compression still translates back and mutates the source body", async () => {
    vi.resetModules();
    const { compressWithHeadroom } = await import("../../open-sse/rtk/headroom.js");
    const fetch = vi.fn(async () => new Response(JSON.stringify({
      messages: [{ role: "user", content: "compressed Claude request" }],
      tokens_saved: 4,
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const body = { messages: [{ role: "user", content: [{ type: "text", text: "original Claude request" }] }] };
    const stats = await compressWithHeadroom(body, {
      enabled: true, url: "http://headroom.test", model: "claude-fixture", format: "claude",
    });
    expect(stats.tokens_saved).toBe(4);
    expect(body.messages[0].content).toEqual([{ type: "text", text: "compressed Claude request" }]);
  });

  it("validates a controlled PNG and enforces byte caps while releasing owned Agents", async () => {
    const lookup = vi.fn().mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    const closes = [];
    const Agent = vi.fn(function () {
      this.close = vi.fn().mockResolvedValue();
      closes.push(this.close);
    });
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const fetch = vi.fn(async () => ({ ok: true, body: { getReader: () => {
      let sent = false;
      return { read: async () => sent ? { done: true } : (sent = true, { done: false, value: png }), cancel: vi.fn(), releaseLock: vi.fn() };
    } } }));
    const fetchImageAsBase64 = await loadImage({ lookup, Agent });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(fetch);
    const good = await fetchImageAsBase64("https://images.example.test/valid.png");
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(Agent).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(good).toMatchObject({ mimeType: "image/png" });
    expect(good.url).toMatch(/^data:image\/png;base64,/);
    const capped = await fetchImageAsBase64("https://images.example.test/capped.png", { maxBytes: 4 });
    expect(capped).toBeNull();
    expect(Agent).toHaveBeenCalledTimes(2);
    expect(closes).toHaveLength(2);
    expect(closes.every(close => close.mock.calls.length === 1)).toBe(true);
  });
});

async function loadAuth() {
  vi.resetModules();
  const connections = vi.fn().mockResolvedValue([{ id: "a", testStatus: "active" }]);
  const settings = vi.fn().mockResolvedValue({ fallbackStrategy: "round-robin", stickyRoundRobinLimit: 2 });
  const pools = vi.fn().mockResolvedValue([{ id: "pool", proxyUrl: "http://proxy.test" }]);
  const update = vi.fn().mockResolvedValue({});
  const resolveProxy = vi.fn().mockResolvedValue({});
  const pick = vi.fn().mockReturnValue("pool");
  vi.doUnmock("@/lib/localDb");
  vi.doUnmock("@/lib/network/connectionProxy");
  vi.doMock("@/lib/localDb", () => ({ getProviderConnections: connections, getSettings: settings, getProxyPools: pools, updateProviderConnection: update, validateApiKey: vi.fn() }));
  vi.doMock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: resolveProxy, pickProxyPoolId: pick }));
  vi.doMock("@/shared/constants/providers.js", () => ({ resolveProviderId: p => p, FREE_PROVIDERS: { publicFixture: { noAuth: true } } }));
  return { ...(await import("../../src/sse/services/auth.js")), connections, settings, pools, update, resolveProxy, pick };
}

const task5b2bMocks = ["@/lib/localDb", "@/lib/network/connectionProxy", "@/shared/constants/providers.js", "open-sse/services/usage/google.js", "../../open-sse/utils/proxyFetch.js"];
describe("Task5B2b auth selection", () => {
  afterEach(() => { for (const name of task5b2bMocks) vi.doUnmock(name); });

  it("pre-aborted selection and account mutations preserve null with no reads or writes", async () => {
    const f = await loadAuth(), owner = new AbortController();
    owner.abort(null);
    await expect(f.getProviderCredentials("fixture", null, "model", { signal: owner.signal })).rejects.toBe(null);
    await expect(f.markAccountUnavailable("a", 429, "rate", "fixture", "model", null, { signal: owner.signal })).rejects.toBe(null);
    await expect(f.clearAccountError("a", { testStatus: "unavailable" }, "model", { signal: owner.signal })).rejects.toBe(null);
    expect(f.connections).not.toHaveBeenCalled();
    expect(f.settings).not.toHaveBeenCalled();
    expect(f.pools).not.toHaveBeenCalled();
    expect(f.pick).not.toHaveBeenCalled();
    expect(f.update).not.toHaveBeenCalled();
  });

  it("a queued canceled middle caller detaches promptly without releasing the held predecessor", async () => {
    const f = await loadAuth(), read = deferred(), started = deferred();
    f.connections.mockImplementationOnce(() => { started.resolve(); return read.promise; });
    const first = f.getProviderCredentials("fixture");
    await started.promise;
    const owner = new AbortController(), reason = new Error("middle left");
    const middle = f.getProviderCredentials("fixture", null, null, { signal: owner.signal }).catch(e => e);
    const last = f.getProviderCredentials("fixture");
    owner.abort(reason);
    const detached = await bounded(middle);
    expect(f.connections).toHaveBeenCalledTimes(1);
    read.resolve([{ id: "a" }]);
    await Promise.all([first, middle, last]);
    expect(detached).toBe(reason);
    expect(f.connections).toHaveBeenCalledTimes(2);
  });

  it.each(["connections", "settings", "pools", "resolveProxy"])("cancellation during %s blocks subsequent side effects and results", async (phase) => {
    const f = await loadAuth(), read = deferred(), started = deferred(), owner = new AbortController();
    const reason = new Error(`${phase} left`);
    if (phase === "pools") f.settings.mockResolvedValue({ providerStrategies: { publicFixture: { rotateStrategy: "round-robin" } } });
    f[phase].mockImplementationOnce(() => { started.resolve(); return read.promise; });
    const work = f.getProviderCredentials(phase === "pools" ? "publicFixture" : "fixture", null, null, { signal: owner.signal }).catch(e => e);
    await started.promise;
    const writes = f.update.mock.calls.length;
    owner.abort(reason);
    const next = f.getProviderCredentials("fixture");
    await turn();
    expect(f.connections.mock.calls.length).toBe(phase === "pools" ? 0 : 1);
    read.resolve(phase === "connections" ? [{ id: "a" }] : phase === "pools" ? [{ id: "pool", proxyUrl: "http://proxy.test" }] : {});
    const result = await work;
    expect(f.update).toHaveBeenCalledTimes(writes);
    expect(f.pick).not.toHaveBeenCalled();
    expect(result).toBe(reason);
    await next;
  });

  it("retains sticky rotation, preference, exclusions and locks while forwarding write signals", async () => {
    const f = await loadAuth(), owner = new AbortController();
    f.connections.mockResolvedValue([
      { id: "a", lastUsedAt: new Date().toISOString(), consecutiveUseCount: 1 },
      { id: "b", priority: 2 },
      { id: "locked", modelLock_model: new Date(Date.now() + 60000).toISOString() },
    ]);
    expect(await f.getProviderCredentials("fixture", null, "model", { signal: owner.signal })).toMatchObject({ connectionId: "a" });
    expect(f.update).toHaveBeenLastCalledWith("a", expect.objectContaining({ consecutiveUseCount: 2 }), { signal: owner.signal });
    expect(await f.getProviderCredentials("fixture", "a", "model")).toMatchObject({ connectionId: "b" });
    expect(f.update.mock.calls.at(-1)).toHaveLength(2);
    expect(await f.getProviderCredentials("fixture", null, "model", { preferredConnectionId: "b" })).toMatchObject({ connectionId: "b" });
    expect(f.update).toHaveBeenCalledTimes(2);
  });

  it("canceling a pending mark read prevents locks and forwards live mark/clear writes", async () => {
    const f = await loadAuth(), owner = new AbortController(), read = deferred(), started = deferred();
    f.connections.mockImplementationOnce(() => { started.resolve(); return read.promise; });
    const work = f.markAccountUnavailable("a", 429, "rate", "fixture", "model", null, { signal: owner.signal }).catch(e => e);
    await started.promise;
    owner.abort("mark left");
    read.resolve([{ id: "a" }]);
    expect(await work).toBe("mark left");
    expect(f.update).not.toHaveBeenCalled();
    const live = new AbortController();
    await f.markAccountUnavailable("a", 429, "rate", "fixture", "model", null, { signal: live.signal });
    expect(f.update).toHaveBeenLastCalledWith("a", expect.objectContaining({ testStatus: "unavailable" }), { signal: live.signal });
    await f.clearAccountError("a", { testStatus: "unavailable" }, "model", { signal: live.signal });
    expect(f.update).toHaveBeenLastCalledWith("a", expect.objectContaining({ testStatus: "active" }), { signal: live.signal });
  });

  it("a canceled awaited selection write retains the mutex until settlement and preserves cancellation over a DB error", async () => {
    const f = await loadAuth(), started = deferred(), owner = new AbortController();
    let fail;
    f.update.mockImplementationOnce(() => { started.resolve(); return new Promise((_resolve, reject) => { fail = reject; }); });
    const first = f.getProviderCredentials("fixture", null, null, { signal: owner.signal }).catch(e => e);
    await started.promise;
    owner.abort("write left");
    const next = f.getProviderCredentials("fixture");
    await turn();
    expect(f.connections).toHaveBeenCalledTimes(1);
    fail(new Error("DB unavailable"));
    expect(await first).toBe("write left");
    expect(await next).toMatchObject({ connectionId: "a" });
    expect(f.resolveProxy).toHaveBeenCalledTimes(1);
  });

  it.each(["mark", "clear"])("%s preserves cancellation when an awaited DB delegate rejects", async kind => {
    const f = await loadAuth(), started = deferred(), owner = new AbortController();
    let fail;
    const pending = () => { started.resolve(); return new Promise((_resolve, reject) => { fail = reject; }); };
    if (kind === "mark") f.connections.mockImplementationOnce(pending);
    else f.update.mockImplementationOnce(pending);
    const work = (kind === "mark" ? f.markAccountUnavailable("a", 429, "rate", "fixture", "model", null, { signal: owner.signal }) : f.clearAccountError("a", { testStatus: "unavailable" }, "model", { signal: owner.signal })).catch(e => e);
    await started.promise;
    owner.abort(null);
    fail(new Error("masked DB error"));
    expect(await work).toBe(null);
  });

  it("signal-less mark and clear keep two-argument writes with legacy non-Promise mocks", async () => {
    const f = await loadAuth();
    f.update.mockReturnValue(undefined);
    expect(await f.markAccountUnavailable("a", 429, "rate", "fixture", "model")).toMatchObject({ shouldFallback: true });
    await f.clearAccountError("a", { testStatus: "unavailable" }, "model");
    expect(f.update).toHaveBeenCalledTimes(2);
    expect(f.update.mock.calls.every(call => call.length === 2)).toBe(true);
  });
});

const weeklyFixture = fraction => ({ groups: [{ displayName: "Gemini Models", buckets: [{ window: "weekly", remainingFraction: fraction, resetTime: "2027-01-01T00:00:00Z" }] }] });
const subscriptionFixture = { cloudaicompanionProject: "fixture-project", currentTier: { name: "Pro" }, paidTier: { id: "pro" } };
const jsonResponse = data => new Response(JSON.stringify(data));
async function loadUsage(fetch) {
  vi.resetModules();
  for (const name of task5b2bMocks) vi.doUnmock(name);
  vi.doMock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: fetch }));
  vi.doMock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: async () => ({}), pickProxyPoolId: vi.fn() }));
  return {
    ...(await import("../../src/sse/services/antigravityQuota.js")),
    ...(await import("../../open-sse/services/usage/google.js")),
    ...(await import("../../open-sse/services/usage/antigravity-weekly.js")),
    ...(await import("../../open-sse/services/usage/shared.js")),
  };
}

describe("Task5B2b shared quota ownership", () => {
  afterEach(() => { for (const name of task5b2bMocks) vi.doUnmock(name); });

  it("two quota owners share real usage dispatch and one leaving retains its survivor", async () => {
    const started = deferred(), response = deferred();
    const fetch = vi.fn((url, opts) => {
      if (url.includes("loadCodeAssist")) { started.resolve(opts.signal); return response.promise; }
      return Promise.resolve(jsonResponse(url.includes("retrieveUserQuotaSummary") ? weeklyFixture(0.75) : { models: {} }));
    });
    const f = await loadUsage(fetch), a = new AbortController(), b = new AbortController();
    const first = f.refreshAntigravityQuota("shared", "fixture", {}, { signal: a.signal }).catch(e => e);
    const second = f.refreshAntigravityQuota("shared", "fixture", {}, { signal: b.signal });
    const shared = await started.promise;
    a.abort("first left");
    const detached = await bounded(first);
    expect(shared.aborted).toBe(false);
    response.resolve(jsonResponse(subscriptionFixture));
    const result = await second;
    expect(detached).toBe("first left");
    expect(result.gemini_weekly.remainingPercentage).toBe(75);
    expect(f.getAntigravityQuotaCache().get("shared")).toBe(result);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("last quota owner cancels actual usage and late completion cannot cache or count strikes; dispatch stays throttled", async () => {
    const started = deferred(), response = deferred();
    const fetch = vi.fn((_url, opts) => { started.resolve(opts.signal); return response.promise; });
    const f = await loadUsage(fetch), owner = new AbortController();
    const work = f.handleAntigravityQuotaError("last", 429, "gemini-fixture", "fixture", {}, { signal: owner.signal }).catch(e => e);
    const shared = await started.promise;
    owner.abort(null);
    const detached = await bounded(work);
    expect(shared.aborted).toBe(true);
    expect(shared.reason).toBe(null);
    response.resolve(jsonResponse(subscriptionFixture));
    await turn();
    expect(detached).toBe(null);
    expect(f.getAntigravityQuotaCache().has("last")).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
    await expect(f.refreshAntigravityQuota("last", "fixture", {})).resolves.toBeNull();
    await expect(f.handleAntigravityQuotaError("last", 429, "gemini-fixture", "fixture", {})).resolves.toBeNull();
    await expect(f.handleAntigravityQuotaError("last", 429, "gemini-fixture", "fixture", {})).resolves.toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("background quota owner survives a later signalled adopter leaving and ordinary failures retain throttle", async () => {
    const started = deferred(), response = deferred();
    const fetch = vi.fn((url, opts) => {
      if (url.includes("loadCodeAssist")) { started.resolve(opts.signal); return response.promise; }
      return Promise.resolve(jsonResponse(url.includes("retrieveUserQuotaSummary") ? weeklyFixture(0.5) : { models: {} }));
    });
    const f = await loadUsage(fetch), owner = new AbortController();
    const background = f.refreshAntigravityQuota("background", "fixture", {});
    const shared = await started.promise;
    const adopter = f.refreshAntigravityQuota("background", "fixture", {}, { signal: owner.signal }).catch(e => e);
    owner.abort("adopter left");
    const detached = await bounded(adopter);
    expect(shared.aborted).toBe(false);
    response.resolve(jsonResponse(subscriptionFixture));
    expect((await background).gemini_weekly.remainingPercentage).toBe(50);
    expect(detached).toBe("adopter left");
    fetch.mockRejectedValue(new Error("ordinary unavailable"));
    expect(await f.refreshAntigravityQuota("ordinary", "fixture", {})).toBeNull();
    const count = fetch.mock.calls.length;
    expect(await f.refreshAntigravityQuota("ordinary", "fixture", {})).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(count);
  });

  it("weekly owners detach independently and successful results retain exactly the 180s TTL", async () => {
    const response = deferred(), started = deferred();
    const fetch = vi.fn((_url, opts) => { started.resolve(opts.signal); return response.promise; });
    const f = await loadUsage(fetch), a = new AbortController(), b = new AbortController();
    const now = Date.now(), clock = vi.spyOn(Date, "now").mockReturnValue(now);
    const first = f.fetchAntigravityWeeklyQuota("fixture", "project", null, { signal: a.signal }).catch(e => e);
    const second = f.fetchAntigravityWeeklyQuota("fixture", "project", null, { signal: b.signal });
    const shared = await started.promise;
    a.abort("weekly left");
    const detached = await bounded(first);
    expect(shared.aborted).toBe(false);
    response.resolve(jsonResponse(weeklyFixture(0.75)));
    const result = await second;
    expect(detached).toBe("weekly left");
    clock.mockReturnValue(now + 179999);
    expect(await f.fetchAntigravityWeeklyQuota("fixture", "project")).toBe(result);
    expect(fetch).toHaveBeenCalledTimes(1);
    clock.mockReturnValue(now + 180000);
    fetch.mockResolvedValue(jsonResponse(weeklyFixture(0.5)));
    expect((await f.fetchAntigravityWeeklyQuota("fixture", "project")).gemini_weekly.remainingPercentage).toBe(50);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("weekly last-owner cancellation cannot evict or cache over its replacement and background ownership survives", async () => {
    const old = deferred(), fresh = deferred();
    const fetch = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    const f = await loadUsage(fetch), owner = new AbortController();
    const abandoned = f.fetchAntigravityWeeklyQuota("fixture", "project", null, { signal: owner.signal }).catch(e => e);
    const oldSignal = fetch.mock.calls[0][1].signal;
    owner.abort("weekly abandoned");
    const detached = await bounded(abandoned);
    expect(oldSignal.aborted).toBe(true);
    const background = f.fetchAntigravityWeeklyQuota("fixture", "project");
    const adopterOwner = new AbortController();
    const adopter = f.fetchAntigravityWeeklyQuota("fixture", "project", null, { signal: adopterOwner.signal }).catch(e => e);
    adopterOwner.abort("adopter abandoned");
    const adopterResult = await bounded(adopter);
    old.resolve(jsonResponse(weeklyFixture(0.1)));
    await turn();
    const joined = f.fetchAntigravityWeeklyQuota("fixture", "project");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1][1].signal.aborted).toBe(false);
    fresh.resolve(jsonResponse(weeklyFixture(0.8)));
    expect((await joined).gemini_weekly.remainingPercentage).toBe(80);
    expect(await background).toBe(await f.fetchAntigravityWeeklyQuota("fixture", "project"));
    expect(detached).toBe("weekly abandoned");
    expect(adopterResult).toBe("adopter abandoned");
    fetch.mockRejectedValue(new Error("ordinary weekly failure"));
    expect(await f.fetchAntigravityWeeklyQuota("other", "project")).toEqual({});
    expect(await f.fetchAntigravityWeeklyQuota("other", "project")).toEqual({});
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("an empty successful usage result does not replace known quota cache or acquire a weekly TTL", async () => {
    const fetch = vi.fn().mockImplementation(async () => jsonResponse({}));
    const f = await loadUsage(fetch), known = { gemini_weekly: { remainingPercentage: 0, resetAt: "2027-01-01T00:00:00Z" } };
    f.getAntigravityQuotaCache().set("empty", known);
    expect(await f.refreshAntigravityQuota("empty", "fixture", {})).toBeNull();
    expect(f.getAntigravityQuotaCache().get("empty")).toBe(known);
    const count = fetch.mock.calls.length;
    expect(await f.fetchAntigravityWeeklyQuota("fixture", null)).toEqual({});
    expect(fetch).toHaveBeenCalledTimes(count + 1);
  });
});

describe("Task5B2b concrete usage lifetime", () => {
  afterEach(() => { for (const name of task5b2bMocks) vi.doUnmock(name); vi.useRealTimers(); });

  it("fetch timeout composes caller cancellation including null, preserves default timeout and legacy arity", async () => {
    const fetch = vi.fn((_url, opts) => new Promise((_resolve, reject) => opts.signal.addEventListener("abort", () => reject(new TypeError("masked abort")), { once: true })));
    const f = await loadUsage(fetch), owner = new AbortController();
    vi.useFakeTimers();
    const work = f.fetchWithTimeout(target, { signal: owner.signal }).catch(e => e);
    owner.abort(null);
    await vi.advanceTimersByTimeAsync(0);
    let settled = false;
    work.then(() => { settled = true; });
    await Promise.resolve();
    const prompt = settled;
    await vi.advanceTimersByTimeAsync(10000);
    expect(await work).toBe(null);
    expect(prompt).toBe(true);
    const timeout = f.fetchWithTimeout(target, {}).catch(e => e);
    const timeoutSignal = fetch.mock.calls.at(-1)[1].signal;
    await vi.advanceTimersByTimeAsync(9999);
    expect(timeoutSignal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(timeoutSignal.aborted).toBe(true);
    expect(await timeout).toBeInstanceOf(TypeError);
    expect(fetch.mock.calls.at(-1)).toHaveLength(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["gemini", "antigravity", "weekly"])("%s post-fetch cancellation prevents JSON/reader acquisition and disposes body", async kind => {
    const owner = new AbortController(), json = vi.fn(), cancel = vi.fn().mockResolvedValue(), getReader = vi.fn();
    const fetch = vi.fn(async () => { owner.abort(null); return { ok: true, status: 200, json, body: { cancel, getReader } }; });
    const f = await loadUsage(fetch);
    const work = kind === "gemini" ? f.getGeminiUsage("fixture", null, null, { signal: owner.signal }) : kind === "weekly" ? f.fetchAntigravityWeeklyQuota("fixture", "project", null, { signal: owner.signal }) : f.getAntigravityUsage("fixture", {}, null, { signal: owner.signal });
    await expect(work).rejects.toBe(null);
    expect(json).not.toHaveBeenCalled();
    expect(getReader).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each(["gemini", "antigravity", "weekly"])("%s native pending body cancellation releases its reader and prevents later delegates", async kind => {
    const owner = new AbortController(), reading = deferred();
    const cancel = vi.fn(() => new Promise(() => {}));
    const stream = new ReadableStream({ pull() { reading.resolve(); }, cancel });
    const response = new Response(stream), release = vi.spyOn(ReadableStreamDefaultReader.prototype, "releaseLock");
    const fetch = vi.fn().mockResolvedValue(response), f = await loadUsage(fetch);
    const work = (kind === "gemini" ? f.getGeminiUsage("fixture", null, null, { signal: owner.signal }) : kind === "weekly" ? f.fetchAntigravityWeeklyQuota("fixture", "project", null, { signal: owner.signal }) : f.getAntigravityUsage("fixture", {}, null, { signal: owner.signal })).catch(e => e);
    await reading.promise;
    await turn();
    const transport = fetch.mock.calls[0][1].signal;
    owner.abort("body left");
    expect(await bounded(work)).toBe("body left");
    expect(transport.aborted).toBe(true);
    expect(cancel).toHaveBeenCalled();
    expect(release).toHaveBeenCalled();
    expect(response.body.locked).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("Antigravity subscription, quota and weekly all keep transport ownership through body completion", async () => {
    const owner = new AbortController(), reading = deferred(), cancel = vi.fn().mockResolvedValue();
    const weekly = new Response(new ReadableStream({ pull() { reading.resolve(); }, cancel }));
    const fetch = vi.fn((url) => Promise.resolve(url.includes("loadCodeAssist") ? jsonResponse(subscriptionFixture) : url.includes("fetchAvailableModels") ? jsonResponse({ models: {} }) : weekly));
    const f = await loadUsage(fetch);
    const work = f.getAntigravityUsage("fixture", {}, null, { signal: owner.signal }).catch(e => e);
    await reading.promise;
    await turn();
    expect(fetch).toHaveBeenCalledTimes(3);
    owner.abort("weekly body left");
    expect(await bounded(work)).toBe("weekly body left");
    for (const [, opts] of fetch.mock.calls) expect(opts.signal.aborted).toBe(true);
    expect(cancel).toHaveBeenCalled();
    expect(weekly.body.locked).toBe(false);
  });

  it("cancel after a legacy JSON await prevents Gemini quota and Antigravity weekly; non-OK bodies are disposed", async () => {
    const owner = new AbortController();
    const json = vi.fn(async () => { owner.abort("json left"); return subscriptionFixture; });
    const fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json });
    const f = await loadUsage(fetch);
    await expect(f.getGeminiUsage("fixture", null, null, { signal: owner.signal })).rejects.toBe("json left");
    expect(fetch).toHaveBeenCalledTimes(1);
    const agOwner = new AbortController();
    fetch.mockResolvedValueOnce(jsonResponse(subscriptionFixture)).mockResolvedValueOnce({ ok: true, status: 200, json: async () => { agOwner.abort("quota left"); return { models: {} }; } });
    await expect(f.getAntigravityUsage("fixture", {}, null, { signal: agOwner.signal })).rejects.toBe("quota left");
    expect(fetch).toHaveBeenCalledTimes(3);
    const cancel = vi.fn().mockResolvedValue();
    fetch.mockResolvedValue({ ok: false, status: 403, body: { cancel } });
    expect(await f.fetchAntigravityWeeklyQuota("nonok", "project")).toEqual({});
    expect(await f.getGeminiUsage("fixture", { projectId: "project" })).toMatchObject({ message: expect.stringContaining("403") });
    expect(cancel).toHaveBeenCalledTimes(2);
  });

  it("cancellation between wrapper headers and the usage continuation disposes the unconsumed response", async () => {
    const owner = new AbortController(), cancel = vi.fn().mockResolvedValue(), json = vi.fn();
    const fetch = vi.fn(async () => {
      queueMicrotask(() => queueMicrotask(() => owner.abort("header gap")));
      return { ok: true, status: 200, body: { cancel }, json };
    });
    const f = await loadUsage(fetch);
    await expect(f.getGeminiUsage("fixture", { projectId: "project" }, null, { signal: owner.signal })).rejects.toBe("header gap");
    expect(json).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});
