// CodeBuddy gateways run a per-request channel check: a request without the
// official plugin's request/conversation ids is rejected with
// HTTP 400 {"code":11128,"msg":"request illegal"} (displayTips: "not sent from
// an official client"). The published build ships the `codebuddyHeaders` hook;
// this locks it into the source tree and both registry entries.
import { describe, expect, it, vi } from "vitest";

// execute() goes through proxyAwareFetch; keep the test offline and return a
// healthy SSE response so the executor reports the headers it actually sent.
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: async () => new Response("data: [DONE]\n\n", {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  }),
}));

import { PROVIDERS } from "../../open-sse/config/providers.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { getExecutor } from "../../open-sse/executors/index.js";

// Every provider that talks to a CodeBuddy gateway (same wire protocol and the
// same x-codebuddy-request header) must attach the channel ids.
const CODEBUDDY_PROVIDERS = ["codebuddy-cn", "codebuddy-intl", "workbuddy"];
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const API_KEY_CRED = { apiKey: "sk-test-APIKEY", providerSpecificData: {} };
const OAUTH_CRED = { accessToken: "tok-test-ACCESS", providerSpecificData: {} };

const channelHeaders = (headers) => ({
  requestId: headers["X-Request-ID"],
  conversationId: headers["X-Conversation-ID"],
  conversationRequestId: headers["X-Conversation-Request-ID"],
  conversationMessageId: headers["X-Conversation-Message-ID"],
});

describe("CodeBuddy channel-check headers", () => {
  for (const id of CODEBUDDY_PROVIDERS) {
    it(`${id} registers the codebuddyHeaders hook`, () => {
      expect(PROVIDERS[id].auth.hooks).toContain("codebuddyHeaders");
    });

    it(`${id} sends the plugin's id trio on a real executor request (apiKey)`, () => {
      const headers = getExecutor(id).buildHeaders(API_KEY_CRED, true);
      const ids = channelHeaders(headers);

      expect(ids.requestId).toMatch(UUID_V4);
      expect(ids.conversationId).toMatch(UUID_V4);
      // The plugin mints one request id and reuses it for the message/request
      // pair; the conversation id is a separate value.
      expect(ids.conversationRequestId).toBe(ids.requestId);
      expect(ids.conversationMessageId).toBe(ids.requestId);
      expect(ids.conversationId).not.toBe(ids.requestId);

      // Hooks run before auth, so the bearer token still lands intact.
      expect(headers.Authorization).toBe(`Bearer ${API_KEY_CRED.apiKey}`);
      expect(headers.Accept).toBe("text/event-stream");
    });

    it(`${id} sends fresh ids per request and on the oauth path`, () => {
      const ex = getExecutor(id);
      const first = channelHeaders(ex.buildHeaders(API_KEY_CRED, true));
      const second = channelHeaders(ex.buildHeaders(API_KEY_CRED, true));
      expect(first.requestId).not.toBe(second.requestId);
      expect(first.conversationId).not.toBe(second.conversationId);

      const oauthHeaders = ex.buildHeaders(OAUTH_CRED, false);
      expect(channelHeaders(oauthHeaders).requestId).toMatch(UUID_V4);
      expect(oauthHeaders.Authorization).toBe(`Bearer ${OAUTH_CRED.accessToken}`);
      // Non-streaming requests skip Accept but keep the ids.
      expect(oauthHeaders.Accept).toBeUndefined();
    });
  }

  it("leaves other providers untouched", () => {
    const headers = new DefaultExecutor("openai").buildHeaders(API_KEY_CRED, true);
    expect(headers["X-Request-ID"]).toBeUndefined();
    expect(headers["X-Conversation-ID"]).toBeUndefined();
  });

  // The unit assertions above cover buildHeaders in isolation; this one proves
  // execute() — the path a chat request really takes — puts them on the wire.
  for (const id of CODEBUDDY_PROVIDERS) {
    it(`${id} puts the channel ids on the request execute() sends`, async () => {
      const result = await getExecutor(id).execute({
        model: "glm-5.3",
        body: { model: "glm-5.3", messages: [{ role: "user", content: "hi" }] },
        stream: true,
        credentials: API_KEY_CRED,
      });

      const ids = channelHeaders(result.headers);
      expect(ids.requestId).toMatch(UUID_V4);
      expect(ids.conversationId).toMatch(UUID_V4);
      expect(ids.conversationRequestId).toBe(ids.requestId);
      expect(ids.conversationMessageId).toBe(ids.requestId);
      expect(result.headers.Authorization).toBe(`Bearer ${API_KEY_CRED.apiKey}`);
    });
  }
});
