import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const PLAYGROUND = "src/app/(dashboard)/dashboard/playground";

describe("playground transcript shell", () => {
  it("renders the empty state art and four suggestions", () => {
    const source = read(`${PLAYGROUND}/PlaygroundEmpty.js`);
    expect(source).toContain("Start a conversation");
    expect(source).toContain("aria-hidden=\"true\"");
    expect(source.match(/suggestion\b/g)?.length).toBeGreaterThan(0);
    expect(source).toContain("Explain how fallback works in a combo");
    expect(source).toContain("Write a curl command to test my endpoint");
    expect(source).toContain("Draft a system prompt for a code reviewer");
    expect(source).toContain("Summarize this stack trace and suggest a fix");
  });

  it("scrolls only its own viewport", () => {
    const source = read(`${PLAYGROUND}/PlaygroundTranscript.js`);
    expect(source).toContain('role="log"');
    expect(source).toContain("aria-label=\"Conversation\"");
    expect(source).toContain("BOTTOM_THRESHOLD = 80");
    expect(source).toContain("element.scrollHeight - element.scrollTop - element.clientHeight < BOTTOM_THRESHOLD");
    expect(source).toContain("Scroll to bottom");
  });

  it("autoscrolls only while the reader is at the bottom", () => {
    const source = read(`${PLAYGROUND}/PlaygroundTranscript.js`);
    expect(source).toMatch(/if \(!atBottomRef\.current\) return/);
    expect(source).toContain("onScroll");
  });
});

describe("playground message row", () => {
  it("keeps the template message anatomy", () => {
    const source = read(`${PLAYGROUND}/PlaygroundMessage.js`);
    expect(source).not.toContain(">YOU<");
    expect(source).toContain("Thought for");
    expect(source).toContain("Retry");
    expect(source).toContain("Rendered");
    expect(source).toContain("Raw");
    expect(source).toContain("Delete reply");
  });

  it("reveals streaming text instead of dumping a whole burst", () => {
    const message = read(`${PLAYGROUND}/PlaygroundMessage.js`);
    const hook = read(`${PLAYGROUND}/useStreamReveal.js`);
    expect(message).toContain("useStreamReveal");
    expect(message).toContain("bodyContent");
    expect(hook).toContain("requestAnimationFrame");
    expect(hook).toContain("prefers-reduced-motion: reduce");
  });

  it("renders user bubbles on the right and dividers between turns", () => {
    const source = read(`${PLAYGROUND}/PlaygroundMessage.js`);
    expect(source).toContain("rowUser");
    expect(source).toContain("divider");
  });

  it("keeps the real metric line", () => {
    const source = read(`${PLAYGROUND}/PlaygroundMessage.js`);
    expect(source).toContain("buildMetaParts");
    expect(source).toContain("metaSep");
  });

  it("only offers retry on the last reply", () => {
    const source = read(`${PLAYGROUND}/PlaygroundMessage.js`);
    expect(source).toContain("isLast ?");
  });

  it("gates the error-block retry to the last reply", () => {
    const source = read(`${PLAYGROUND}/PlaygroundMessage.js`);
    // handleRetry truncates the session at the retried question, so an older errored
    // reply must not offer Retry or it would silently drop every later turn.
    const errorBlock = source.slice(source.indexOf('message.status === "error" ? ('));
    const retryButton = errorBlock.indexOf("styles.retryButton");
    expect(retryButton).toBeGreaterThan(-1);
    expect(errorBlock.slice(0, retryButton)).toContain("{isLast ? (");
    expect(errorBlock).toContain('role="alert"');
  });
});

describe("playground message row review fixes", () => {
  it("routes combos to the neutral tile instead of a provider logo", () => {
    const source = read(`${PLAYGROUND}/PlaygroundModelIcon.js`);
    expect(source).toContain("!providerId || isCombo");
    expect(source).toContain("<ProviderIcon");
  });

  it("renders the provider tag only when there is one", () => {
    const source = read(`${PLAYGROUND}/PlaygroundMessage.js`);
    expect(source).toContain("message.isCombo || message.providerName ?");
    expect(source).not.toContain('message.providerName || ""');
  });

  it("disables copy on a reply with nothing to copy", () => {
    const source = read(`${PLAYGROUND}/PlaygroundMessage.js`);
    expect(source).toContain("disabled={!message.content && !message.reasoning}");
    expect(source).toContain('{copied ? "Copied" : "Copy"}');
  });

  it("offers follow-ups only on a completed reply", () => {
    const source = read(`${PLAYGROUND}/PlaygroundMessage.js`);
    expect(source).toContain('message.status === "done" && message.followUps?.length');
  });

  it("keys follow-up pills by question and position", () => {
    const source = read(`${PLAYGROUND}/PlaygroundMessage.js`);
    expect(source).toContain("message.followUps.map((question, index)");
    expect(source).toContain("key={`${question}-${index}`}");
  });
});

describe("playground composer", () => {
  it("hosts the model trigger and toggles in the composer", () => {
    const source = read(`${PLAYGROUND}/PlaygroundComposer.js`);
    expect(source).toContain("data-model-trigger");
    expect(source).toContain("History");
    expect(source).toContain("Think");
    expect(source).toContain("aria-pressed={think}");
    expect(source).toContain("aria-expanded={settingsOpen}");
  });

  it("implements the six slash commands", () => {
    const source = read(`${PLAYGROUND}/PlaygroundComposer.js`);
    for (const key of ["/new", "/clear", "/history", "/model", "/settings", "/export"]) {
      expect(source).toContain(`key: "${key}"`);
    }
    expect(source).toContain("ArrowDown");
    expect(source).toContain("ArrowUp");
  });

  it("keeps Enter to send and Shift+Enter for a newline", () => {
    const source = read(`${PLAYGROUND}/PlaygroundComposer.js`);
    expect(source).toContain("!event.shiftKey");
    expect(source).toContain("isComposing");
  });

  it("uses the shared rail picker", () => {
    const popover = read(`${PLAYGROUND}/ModelPickerPopover.js`);
    expect(popover).toContain('variant="rail"');
    expect(popover).toContain("favorites={favorites}");
    expect(popover).toContain("onToggleFavorite={onToggleFavorite}");
  });
});

describe("playground settings popover", () => {
  it("carries the four template presets", () => {
    const source = read(`${PLAYGROUND}/PlaygroundSettingsPopover.js`);
    for (const name of ["Default", "Senior dev", "JSON output", "Concise"]) {
      expect(source).toContain(`"${name}"`);
    }
  });

  it("exposes the sampling controls", () => {
    const source = read(`${PLAYGROUND}/PlaygroundSettingsPopover.js`);
    expect(source).toContain("min=\"0\"");
    expect(source).toContain("max=\"2\"");
    expect(source).toContain("step=\"0.05\"");
    for (const value of [1024, 2048, 4096, 8192]) {
      expect(source).toContain(String(value));
    }
    expect(source).toContain("Top P");
  });

  it("labels the helper as billed extra calls", () => {
    const source = read(`${PLAYGROUND}/PlaygroundSettingsPopover.js`);
    expect(source).toContain('role="switch"');
    expect(source).toContain("Extra billed calls");
  });

  it("requires a second click to clear", () => {
    const source = read(`${PLAYGROUND}/PlaygroundSettingsPopover.js`);
    expect(source).toContain("Click again to clear");
    expect(source).toContain("clearArmed");
  });
});

describe("playground dialogs", () => {
  it("lists conversations with search and per-row actions", () => {
    const source = read(`${PLAYGROUND}/PlaygroundHistoryModal.js`);
    expect(source).toContain("Conversations");
    expect(source).toContain("Switch or manage saved chat sessions");
    expect(source).toContain("Search chats");
    expect(source).toContain("Active");
    expect(source).toContain("onDuplicate");
    expect(source).toContain("onDelete");
    expect(source).toContain("trapFocus");
  });

  it("exports the three languages", () => {
    const source = read(`${PLAYGROUND}/PlaygroundExportModal.js`);
    expect(source).toContain('"cURL"');
    expect(source).toContain('"JavaScript"');
    expect(source).toContain('"Python"');
    expect(source).toContain("renderCurl");
    expect(source).toContain("renderJavaScript");
    expect(source).toContain("renderPython");
    expect(source).toContain("onCopy");
  });

  it("ignores row key presses that originate on a row action button", () => {
    const source = read(`${PLAYGROUND}/PlaygroundHistoryModal.js`);
    // Enter/Space on the nested Duplicate/Delete buttons must not bubble into the row's
    // select handler, or the page closes the dialog and neither action is keyboard-usable.
    expect(source).toContain("if (event.target !== event.currentTarget) return;");
    expect(source).toMatch(/onKeyDown=\{\(event\) => \{\s*if \(event\.target !== event\.currentTarget\) return;/);
    expect(source).toContain("event.key === \"Enter\"");
  });
});

describe("playground stylesheet", () => {
  it("uses the template radius and tokens", () => {
    const css = read(`${PLAYGROUND}/playground.module.css`);
    expect(css).toContain("border-radius: var(--r4)");
    expect(css).toContain("var(--brand-lavender)");
    expect(css).toContain("var(--surface-card)");
  });

  it("drops the old toolbar layout", () => {
    const css = read(`${PLAYGROUND}/playground.module.css`);
    expect(css).not.toContain(".toolbar");
    expect(css).not.toContain(".modelTrigger");
  });

  it("keeps the composer flat and the mobile caps", () => {
    const css = read(`${PLAYGROUND}/playground.module.css`);
    expect(css).not.toContain(".composerWrap::before");
    const composer = css.slice(css.indexOf(".composer {"), css.indexOf(".composer:focus-within"));
    expect(composer).not.toContain("box-shadow");
    const mobile = css.slice(css.lastIndexOf("@media (max-width: 639px)"));
    expect(mobile).toContain("max-height: min(200px, 25dvh)");
    const landscape = css.slice(css.indexOf("@media (max-width: 1023px) and (max-height: 500px)"));
    expect(landscape).toContain("max-height: min(200px, 20dvh)");
  });
});

describe("playground dialogs and markdown", () => {
  it("styles the history and export dialogs", () => {
    const css = read(`${PLAYGROUND}/playground-dialogs.module.css`);
    for (const name of ["historyDialog", "historyRow", "activeBadge", "exportTabs", "exportCode", "exportActions"]) {
      expect(css).toContain(`.${name}`);
    }
    expect(css).toContain("width: min(660px");
  });

  it("keeps the assistant type scale", () => {
    const css = read(`${PLAYGROUND}/playground-markdown.module.css`);
    expect(css).toContain("font-size: 15px");
    expect(css).toContain("border-radius: 14px");
  });
});

describe("playground page composition", () => {
  it("drops the top toolbar and mounts the new surface", () => {
    const source = read(`${PLAYGROUND}/PlaygroundPageClient.js`);
    expect(source).not.toContain("styles.toolbar");
    expect(source).not.toContain("styles.modelTrigger");
    for (const name of ["PlaygroundTranscript", "PlaygroundComposer", "PlaygroundHistoryModal", "PlaygroundExportModal", "PlaygroundSettingsPopover"]) {
      expect(source).toContain(name);
    }
  });

  it("wires sessions, helpers and the header title", () => {
    const source = read(`${PLAYGROUND}/PlaygroundPageClient.js`);
    expect(source).toContain("usePlaygroundSessions");
    expect(source).toContain("usePlaygroundChat");
    expect(source).toContain("usePlaygroundHints");
    expect(source).toContain("useHeaderTitleStore");
    expect(source).toContain("SETTINGS_KEY");
    expect(source).toContain("FAVORITES_KEY");
  });

  it("persists the active conversation model and dividers", () => {
    const source = read(`${PLAYGROUND}/PlaygroundPageClient.js`);
    expect(source).toContain("Model switched to");
    expect(source).toContain("localTitle");
  });

  it("keeps the old page-header strings out", () => {
    const source = read(`${PLAYGROUND}/PlaygroundPageClient.js`);
    expect(source).not.toContain("Test and compare models through JRouter");
    expect(source).not.toContain("styles.header");
    expect(source).not.toContain("styles.eyebrow");
  });

  it("anchors the last-reply flags to the last assistant message", () => {
    const source = read(`${PLAYGROUND}/PlaygroundPageClient.js`);
    // A trailing model-switch divider must not become the "last" message, or the
    // reply above it loses Retry and the follow-up pills.
    expect(source).toContain("[...messages].reverse().find(");
    expect(source).toMatch(/\.reverse\(\)\.find\(\(message\) => message\.role === "assistant"\)/);
    expect(source).toContain("lastId = lastAssistant?.id");
  });

  it("returns from the finish gate when a turn was stopped", () => {
    const source = read(`${PLAYGROUND}/PlaygroundPageClient.js`);
    const finishTurn = source.slice(source.indexOf("const finishTurn"), source.indexOf("const { isStreaming"));
    expect(finishTurn).toContain("stopped");
    expect(finishTurn).toMatch(/if \(stopped \|\|.*\) return;/);
  });

  it("asks for a title only on the first turn with the helper on", () => {
    const source = read(`${PLAYGROUND}/PlaygroundPageClient.js`);
    expect(source).toContain("if (firstTurn && settings.helper) requestTitle(sessionId, text);");
  });
});

describe("playground review fixes", () => {
  it("relabels a trailing model-switch divider instead of stacking a second one", () => {
    const source = read(`${PLAYGROUND}/PlaygroundPageClient.js`);
    const branch = source.slice(
      source.indexOf("One divider per model change"),
      source.indexOf("setPickerOpen(false);"),
    );
    expect(branch).toContain('last?.role === "divider"');
    expect(branch).toContain(": [...session.messages");
    // Isolate the relabel arm: the append arm uses the same prefix string, so a
    // whole-branch search would pass even when the relabel keeps the old name.
    const relabel = branch.slice(
      branch.indexOf('last?.role === "divider"'),
      branch.indexOf(": [...session.messages"),
    );
    expect(relabel).toContain("index === lastIndex");
    expect(relabel).toContain("content: `${DIVIDER_PREFIX}${next.name}`");
    // Only the non-divider case appends; a trailing divider is relabelled in place.
    expect(branch.match(/role: "divider"/g)?.length).toBe(1);
  });

  it("truncates the session at the retried question before replaying it", () => {
    const source = read(`${PLAYGROUND}/PlaygroundPageClient.js`);
    const retry = source.slice(source.indexOf("const handleRetry"), source.indexOf("const handleStop"));
    expect(retry).toContain("updateSessionMessages(activeSession.id, () => messages.slice(0, questionIndex));");
    expect(retry).toContain("history: messages.slice(0, questionIndex)");
    // The old reply must be dropped, not sliced off at its own index.
    expect(retry).not.toContain("messages.slice(0, index)");
  });

  it("stops the stream and helper calls before duplicating a conversation", () => {
    const source = read(`${PLAYGROUND}/PlaygroundPageClient.js`);
    const handler = source.slice(
      source.indexOf("const handleDuplicateSession"),
      source.indexOf("const handleDeleteSession"),
    );
    expect(handler).toMatch(/stop\(\);\s*cancelAll\(\);\s*duplicateSession\(session\);/);
  });

  it("reports a failed turn back to the page", () => {
    const source = read(`${PLAYGROUND}/usePlaygroundChat.js`);
    expect(source).toMatch(/onFinish,\s*onError,/);
    expect(source).toContain("onError?.({ sessionId, question");
    expect(source).toContain("[apiKey, settings, onAppend, onPatch, onFinish, onError]");
  });

  it("restores a failed prompt without clobbering a draft", () => {
    const source = read(`${PLAYGROUND}/PlaygroundPageClient.js`);
    expect(source).toContain("onError: restoreFailedPrompt");
    expect(source).toContain("if (sessionId !== activeIdRef.current) return;");
    expect(source).toContain("setInput((current) => current || question)");
  });
});

describe("playground polish", () => {
  it("shows provider logos and the JRouter mark in the picker rail", () => {
    const picker = read("src/shared/components/ModelPickerList.js");
    expect(picker).toContain("ProviderIcon");
    expect(picker).toContain("AppLogo");
    expect(picker).toMatch(/entry\.providerId \? \(/);
    expect(picker).toContain('entry.key === "favorites"');
  });

  it("uses themed scrollbars in the transcript and the picker", () => {
    const thread = read(`${PLAYGROUND}/playground.module.css`);
    const picker = read("src/shared/components/ModelPickerList.module.css");
    expect(thread).toContain(".transcript::-webkit-scrollbar");
    expect(thread).toContain("scrollbar-color: var(--line-2) transparent");
    expect(picker).toContain(".rail::-webkit-scrollbar");
    expect(picker).toContain(".rows::-webkit-scrollbar");
  });
});
