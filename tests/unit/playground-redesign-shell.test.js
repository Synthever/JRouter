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
    expect(source).toContain("YOU");
    expect(source).toContain("Thought for");
    expect(source).toContain("Retry");
    expect(source).toContain("Rendered");
    expect(source).toContain("Raw");
    expect(source).toContain("Delete reply");
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
