import type { ReactNode } from "react";
import { Fragment } from "react";

const LIST_LINE = /^(\d+\.\s+|[-•]\s+)/;

function stripStrayMarkdown(text: string): string {
  return text
    .replace(/`/g, "")
    .replace(/_/g, "")
    .replace(/(?<!\*)\*(?!\*)/g, "")
    .replace(/^#+\s*/gm, "");
}

function parseInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let part = 0;
  while (cursor < text.length) {
    const open = text.indexOf("**", cursor);
    if (open === -1) {
      const tail = stripStrayMarkdown(text.slice(cursor));
      if (tail) nodes.push(tail);
      break;
    }
    if (open > cursor) {
      const plain = stripStrayMarkdown(text.slice(cursor, open));
      if (plain) nodes.push(plain);
    }
    const close = text.indexOf("**", open + 2);
    if (close === -1) {
      nodes.push(stripStrayMarkdown(text.slice(open)));
      break;
    }
    const inner = stripStrayMarkdown(text.slice(open + 2, close));
    if (inner) {
      nodes.push(<strong key={`${keyPrefix}-b-${part}`}>{inner}</strong>);
      part += 1;
    }
    cursor = close + 2;
  }
  return nodes.length > 0 ? nodes : [stripStrayMarkdown(text)];
}

/** Safe assistant reply text: bold, line breaks, and simple list lines only. */
export function AssistantReplyBody({ text }: { text: string }): ReactNode {
  const lines = text.split("\n");
  const blocks: ReactNode[] = [];
  let listItems: ReactNode[] = [];
  let index = 0;

  const flushList = () => {
    if (listItems.length === 0) return;
    blocks.push(
      <ul key={`ul-${index}`} className="m-0 list-outside ps-0">
        {listItems}
      </ul>,
    );
    listItems = [];
    index += 1;
  };

  for (const line of lines) {
    const trimmed = line.trimEnd();
    if (LIST_LINE.test(trimmed)) {
      const body = trimmed.replace(LIST_LINE, "");
      listItems.push(
        <li key={`li-${index}`} className="ms-5 list-disc">
          {parseInline(body, `li-${index}`)}
        </li>,
      );
      index += 1;
      continue;
    }
    flushList();
    if (trimmed === "") {
      blocks.push(<br key={`br-${index}`} />);
    } else {
      blocks.push(<Fragment key={`p-${index}`}>{parseInline(trimmed, `p-${index}`)}</Fragment>);
    }
    index += 1;
  }
  flushList();
  return <>{blocks}</>;
}