"use client";
import PropTypes from "prop-types";

import { Fragment, useMemo } from "react";
import styles from "./playground.module.css";

// Minimal Markdown renderer for assistant output. Every construct becomes a React
// node — never an HTML string — so untrusted model text cannot inject markup.
// Supports fenced code blocks, headings, lists, paragraphs, inline code and emphasis.

const INLINE_PATTERN = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*\n]+\*)/g;
const BULLET_PATTERN = /^\s*[-*+]\s+/;
const ORDERED_PATTERN = /^\s*\d+[.)]\s+/;
const HEADING_PATTERN = /^(#{1,6})\s+(.*)$/;
// A fence left open by a still-streaming message renders as a code block too.
const UNCLOSED_FENCE_PATTERN = /```([^\n`]*)\n?([\s\S]*)$/;

function renderInline(text, keyPrefix) {
  if (!text) return null;
  return text
    .split(INLINE_PATTERN)
    .filter((part) => part !== "")
    .map((part, index) => {
      const key = `${keyPrefix}-${index}`;
      if (part.length > 2 && part.startsWith("`") && part.endsWith("`")) {
        return <code key={key} className={styles.inlineCode}>{part.slice(1, -1)}</code>;
      }
      if (part.length > 4 && part.startsWith("**") && part.endsWith("**")) {
        return <strong key={key}>{part.slice(2, -2)}</strong>;
      }
      if (part.length > 2 && part.startsWith("*") && part.endsWith("*")) {
        return <em key={key}>{part.slice(1, -1)}</em>;
      }
      return <Fragment key={key}>{part}</Fragment>;
    });
}

function renderProse(text, keyPrefix) {
  const nodes = [];
  let paragraph = [];
  let list = null;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const key = `${keyPrefix}-p${nodes.length}`;
    nodes.push(
      <p key={key} className={styles.paragraph}>
        {paragraph.map((line, index) => (
          <Fragment key={`${key}-${index}`}>
            {index > 0 ? <br /> : null}
            {renderInline(line, `${key}-${index}`)}
          </Fragment>
        ))}
      </p>
    );
    paragraph = [];
  };

  const flushList = () => {
    if (!list) return;
    const key = `${keyPrefix}-l${nodes.length}`;
    const items = list.items.map((item, index) => (
      <li key={`${key}-${index}`}>{renderInline(item, `${key}-${index}`)}</li>
    ));
    nodes.push(
      list.ordered
        ? <ol key={key} className={styles.list}>{items}</ol>
        : <ul key={key} className={styles.list}>{items}</ul>
    );
    list = null;
  };

  for (const line of text.split("\n")) {
    const heading = line.match(HEADING_PATTERN);
    if (heading) {
      flushParagraph();
      flushList();
      const key = `${keyPrefix}-h${nodes.length}`;
      nodes.push(<p key={key} className={styles.proseHeading}>{renderInline(heading[2], key)}</p>);
      continue;
    }

    const ordered = ORDERED_PATTERN.test(line);
    if (ordered || BULLET_PATTERN.test(line)) {
      flushParagraph();
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push(line.replace(ordered ? ORDERED_PATTERN : BULLET_PATTERN, ""));
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  flushParagraph();
  flushList();
  return nodes;
}

function renderCode(code, language, key) {
  return (
    <pre key={key} className={styles.codeBlock}>
      {language ? <span className={styles.codeLang}>{language}</span> : null}
      <code>{code.replace(/\n$/, "")}</code>
    </pre>
  );
}

export default function PlaygroundMarkdown({ content }) {
  const blocks = useMemo(() => {
    const text = content || "";
    const nodes = [];
    const fencePattern = /```([^\n`]*)\n?([\s\S]*?)```/g;
    let lastIndex = 0;
    let match = fencePattern.exec(text);

    while (match) {
      if (match.index > lastIndex) {
        nodes.push(...renderProse(text.slice(lastIndex, match.index), `t${lastIndex}`));
      }
      nodes.push(renderCode(match[2], match[1].trim(), `c${lastIndex}`));
      lastIndex = fencePattern.lastIndex;
      match = fencePattern.exec(text);
    }

    const rest = text.slice(lastIndex);
    const unclosed = rest.match(UNCLOSED_FENCE_PATTERN);
    if (unclosed) {
      if (unclosed.index > 0) {
        nodes.push(...renderProse(rest.slice(0, unclosed.index), `u${lastIndex}`));
      }
      nodes.push(renderCode(unclosed[2], unclosed[1].trim(), `uc${lastIndex}`));
    } else if (rest) {
      nodes.push(...renderProse(rest, `r${lastIndex}`));
    }

    return nodes;
  }, [content]);

  return <div className={styles.prose}>{blocks}</div>;
}

PlaygroundMarkdown.propTypes = {
  content: PropTypes.string,
};
