"use client";

import PropTypes from "prop-types";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";

import Icon from "@/shared/components/Icon";
import styles from "./playground-markdown.module.css";

// Assistant output is untrusted, so every construct becomes a React element — never an
// HTML string — and only http(s)/mailto hrefs are allowed to become anchors.

const FENCE_PATTERN = /```([^\n`]*)\n?([\s\S]*?)```/g;
// A fence left open by a still-streaming message renders as a code block too.
const UNCLOSED_FENCE_PATTERN = /```([^\n`]*)\n?([\s\S]*)$/;
const HEADING_PATTERN = /^(#{1,6})\s+(.*)$/;
const RULE_PATTERN = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const QUOTE_PATTERN = /^ {0,3}>\s?(.*)$/;
const LIST_ITEM_PATTERN = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const TABLE_DIVIDER_PATTERN = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;
const INLINE_PATTERN = /(`[^`\n]+`|\*\*[^*\n]+\*\*|~~[^~\n]+~~|\*[^*\n]+\*|\[[^\]\n]*\]\([^()\s]+\))/g;
const LINK_PATTERN = /^\[([^\]\n]*)\]\(([^()\s]+)\)$/;
const SAFE_HREF_PATTERN = /^(?:https?:\/\/|mailto:)/i;
const COPY_RESET_MS = 1500;

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
        return <strong key={key} className={styles.strong}>{part.slice(2, -2)}</strong>;
      }
      if (part.length > 4 && part.startsWith("~~") && part.endsWith("~~")) {
        return <del key={key} className={styles.strike}>{part.slice(2, -2)}</del>;
      }
      if (part.length > 2 && part.startsWith("*") && part.endsWith("*")) {
        return <em key={key}>{part.slice(1, -1)}</em>;
      }
      const link = part.match(LINK_PATTERN);
      if (link) {
        if (!SAFE_HREF_PATTERN.test(link[2])) {
          // Unsafe scheme (javascript:, data:, …): keep the raw text, never an href.
          return <Fragment key={key}>{part}</Fragment>;
        }
        return (
          <a key={key} className={styles.link} href={link[2]} target="_blank" rel="noreferrer noopener">
            {link[1] || link[2]}
          </a>
        );
      }
      return <Fragment key={key}>{part}</Fragment>;
    });
}

function splitRow(line) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

function isTableStart(lines, index) {
  const header = lines[index];
  const divider = lines[index + 1];
  return Boolean(header && divider && header.includes("|") && divider.includes("|") && TABLE_DIVIDER_PATTERN.test(divider));
}

const indentWidth = (whitespace) => whitespace.replace(/\t/g, "  ").length;
const isOrderedMarker = (marker) => /^\d/.test(marker);

function buildList(lines, startIndex) {
  const first = lines[startIndex].match(LIST_ITEM_PATTERN);
  const root = { indent: indentWidth(first[1]), ordered: isOrderedMarker(first[2]), items: [] };
  const stack = [root];
  let index = startIndex;

  while (index < lines.length) {
    const item = lines[index].match(LIST_ITEM_PATTERN);
    if (!item) break;
    const indent = indentWidth(item[1]);
    const ordered = isOrderedMarker(item[2]);
    // A marker change at the list's own level starts a sibling list instead.
    if (indent <= root.indent && ordered !== root.ordered) break;

    while (stack.length > 1 && indent < stack[stack.length - 1].indent) stack.pop();
    const top = stack[stack.length - 1];

    if (indent >= top.indent + 2 && top.items.length > 0) {
      const nested = { indent, ordered, items: [] };
      top.items[top.items.length - 1].children = nested;
      stack.push(nested);
    } else if (ordered !== top.ordered && indent <= top.indent && stack.length > 1) {
      const parent = stack[stack.length - 2];
      const nested = { indent, ordered, items: [] };
      if (parent.items.length > 0) parent.items[parent.items.length - 1].children = nested;
      stack[stack.length - 1] = nested;
    }

    stack[stack.length - 1].items.push({ content: item[3], children: null });
    index += 1;
  }

  return { list: root, nextIndex: index };
}

function renderList(list, keyPrefix) {
  const Tag = list.ordered ? "ol" : "ul";
  const className = `${styles.list} ${list.ordered ? styles.listOrdered : styles.listUnordered}`;
  return (
    <Tag key={keyPrefix} className={className}>
      {list.items.map((item, index) => (
        <li key={`${keyPrefix}-${index}`}>
          {renderInline(item.content, `${keyPrefix}-${index}`)}
          {item.children ? renderList(item.children, `${keyPrefix}-${index}n`) : null}
        </li>
      ))}
    </Tag>
  );
}

function renderTable(header, rows, key) {
  return (
    <div key={key} className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            {header.map((cell, column) => (
              <th key={`h${column}`} scope="col">{renderInline(cell, `${key}h${column}`)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={`r${rowIndex}`}>
              {header.map((cell, column) => (
                <td key={`c${column}`}>{renderInline(row[column] || "", `${key}r${rowIndex}c${column}`)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function isBlockStart(lines, index) {
  const line = lines[index];
  if (!line.trim()) return true;
  if (HEADING_PATTERN.test(line)) return true;
  if (RULE_PATTERN.test(line)) return true;
  if (QUOTE_PATTERN.test(line)) return true;
  if (LIST_ITEM_PATTERN.test(line)) return true;
  return isTableStart(lines, index);
}

async function copyText(text) {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Clipboard API is unavailable on insecure origins and can be denied — fall through.
  }

  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "-1000px";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(area);
    return copied;
  } catch {
    return false;
  }
}

function CodeBlock({ code, language }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  const handleCopy = useCallback(async () => {
    if (!(await copyText(code))) return;
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), COPY_RESET_MS);
  }, [code]);

  return (
    <div className={styles.codeBlock}>
      <div className={styles.codeHeader}>
        {language ? <span className={styles.codeLang}>{language}</span> : null}
        <button
          type="button"
          className={styles.copyButton}
          onClick={handleCopy}
          data-copied={copied ? "true" : undefined}
          aria-label={copied ? "Code copied" : "Copy code"}
        >
          <Icon name={copied ? "check" : "content_copy"} size={12} />
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>
      <pre className={styles.codeBody}>
        <code>{code.replace(/\n$/, "")}</code>
      </pre>
    </div>
  );
}

CodeBlock.propTypes = {
  code: PropTypes.string.isRequired,
  language: PropTypes.string,
};

function renderBlocks(lines, keyPrefix) {
  const nodes = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const key = `${keyPrefix}-${nodes.length}`;

    if (!line.trim()) {
      index += 1;
      continue;
    }

    const heading = line.match(HEADING_PATTERN);
    if (heading) {
      const level = heading[1].length;
      const Tag = `h${level}`;
      nodes.push(
        <Tag key={key} className={`${styles.heading} ${styles[`heading${level}`]}`}>
          {renderInline(heading[2], key)}
        </Tag>
      );
      index += 1;
      continue;
    }

    if (RULE_PATTERN.test(line)) {
      nodes.push(<hr key={key} className={styles.rule} />);
      index += 1;
      continue;
    }

    if (QUOTE_PATTERN.test(line)) {
      const quoted = [];
      while (index < lines.length && QUOTE_PATTERN.test(lines[index])) {
        quoted.push(lines[index].match(QUOTE_PATTERN)[1]);
        index += 1;
      }
      nodes.push(
        <blockquote key={key} className={styles.blockquote}>
          {quoted.map((entry, lineIndex) => (
            <Fragment key={`${key}-${lineIndex}`}>
              {lineIndex > 0 ? <br /> : null}
              {renderInline(entry, `${key}-${lineIndex}`)}
            </Fragment>
          ))}
        </blockquote>
      );
      continue;
    }

    if (isTableStart(lines, index)) {
      const header = splitRow(line);
      const rows = [];
      index += 2;
      while (index < lines.length && lines[index].trim() && lines[index].includes("|")) {
        rows.push(splitRow(lines[index]));
        index += 1;
      }
      nodes.push(renderTable(header, rows, key));
      continue;
    }

    if (LIST_ITEM_PATTERN.test(line)) {
      const built = buildList(lines, index);
      nodes.push(renderList(built.list, key));
      index = built.nextIndex;
      continue;
    }

    const paragraph = [];
    while (index < lines.length && !isBlockStart(lines, index)) {
      paragraph.push(lines[index]);
      index += 1;
    }
    nodes.push(
      <p key={key} className={styles.paragraph}>
        {paragraph.map((entry, lineIndex) => (
          <Fragment key={`${key}-${lineIndex}`}>
            {lineIndex > 0 ? <br /> : null}
            {renderInline(entry, `${key}-${lineIndex}`)}
          </Fragment>
        ))}
      </p>
    );
  }

  return nodes;
}

export default function PlaygroundMarkdown({ content }) {
  const blocks = useMemo(() => {
    const text = content || "";
    const nodes = [];
    let lastIndex = 0;
    let codeIndex = 0;
    let match = FENCE_PATTERN.exec(text);

    while (match) {
      if (match.index > lastIndex) {
        nodes.push(...renderBlocks(text.slice(lastIndex, match.index).split("\n"), `t${lastIndex}`));
      }
      nodes.push(<CodeBlock key={`c${codeIndex}`} code={match[2]} language={match[1].trim().split(/\s+/)[0]} />);
      codeIndex += 1;
      lastIndex = FENCE_PATTERN.lastIndex;
      match = FENCE_PATTERN.exec(text);
    }

    const rest = text.slice(lastIndex);
    const unclosed = rest.match(UNCLOSED_FENCE_PATTERN);
    if (unclosed) {
      if (unclosed.index > 0) {
        nodes.push(...renderBlocks(rest.slice(0, unclosed.index).split("\n"), `u${lastIndex}`));
      }
      nodes.push(<CodeBlock key={`c${codeIndex}`} code={unclosed[2]} language={unclosed[1].trim().split(/\s+/)[0]} />);
    } else if (rest) {
      nodes.push(...renderBlocks(rest.split("\n"), `r${lastIndex}`));
    }

    return nodes;
  }, [content]);

  return <div className={styles.prose}>{blocks}</div>;
}

PlaygroundMarkdown.propTypes = {
  content: PropTypes.string,
};
