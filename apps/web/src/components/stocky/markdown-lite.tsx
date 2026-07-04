import { Fragment, type ReactNode } from "react";
import { Link } from "react-router";

/**
 * Deliberately tiny renderer for Stocky's constrained output: paragraphs,
 * **bold**, `code`, "- " bullets, and [label](path) links. Links render as
 * router Links ONLY for in-app paths (/l/...) — anything else stays plain
 * text, which doubles as an XSS/exfiltration guard (no external URLs, no
 * raw HTML, ever).
 */

const INLINE_RE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g;

function renderInline(text: string, keyBase: string, onNavigate?: () => void): ReactNode[] {
  const parts = text.split(INLINE_RE);
  return parts.map((part, i) => {
    const key = `${keyBase}-${i}`;
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={key}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code key={key} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
          {part.slice(1, -1)}
        </code>
      );
    }
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part);
    if (link) {
      const [, label, path] = link;
      if (path!.startsWith("/l/")) {
        return (
          <Link key={key} to={path!} onClick={onNavigate} className="font-medium text-primary underline underline-offset-2 hover:opacity-80">
            {label}
          </Link>
        );
      }
      return <Fragment key={key}>{label}</Fragment>; // non-app path: label only
    }
    return <Fragment key={key}>{part}</Fragment>;
  });
}

export function MarkdownLite({ text, onNavigate }: { text: string; onNavigate?: () => void }) {
  const blocks = text.split(/\n{2,}/).filter((b) => b.trim().length > 0);
  return (
    <div className="space-y-2">
      {blocks.map((block, bi) => {
        const lines = block.split("\n");
        const isList = lines.every((l) => l.trim().startsWith("- ") || l.trim() === "");
        if (isList) {
          return (
            <ul key={bi} className="list-disc space-y-1 pl-5">
              {lines
                .filter((l) => l.trim().startsWith("- "))
                .map((l, li) => (
                  <li key={li}>{renderInline(l.trim().slice(2), `${bi}-${li}`, onNavigate)}</li>
                ))}
            </ul>
          );
        }
        return (
          <p key={bi} className="leading-relaxed">
            {lines.map((l, li) => (
              <Fragment key={li}>
                {li > 0 && <br />}
                {renderInline(l, `${bi}-${li}`, onNavigate)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}
