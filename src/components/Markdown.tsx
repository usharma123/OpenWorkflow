import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/*
 * Model output arrives as markdown. Raw HTML is never enabled, so nothing the
 * model emits can inject markup into the app.
 */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children: content }) => (
            <a href={href} target="_blank" rel="noreferrer noopener">
              {content}
            </a>
          ),
          table: ({ children: content }) => (
            <div className="md-table-scroll">
              <table>{content}</table>
            </div>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
