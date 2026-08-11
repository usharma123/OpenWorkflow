import { Check, Loader2, Send, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  convexClient,
  listBuildChatMessagesRef,
  sendBuildChatMessageRef,
  type BuildChatMessage,
} from "../lib/convexClient";

export interface BuildChatGraph {
  name: string;
  description: string;
  nodes: unknown[];
  edges: unknown[];
}

interface BuildChatProps {
  workflowExternalId: string;
  getGraph: () => BuildChatGraph;
  onApply: (message: BuildChatMessage) => void;
}

const STARTERS = [
  "Summarize my unread email every morning and post the digest in Slack",
  "Research a topic on the web and save a cited brief to Google Docs",
  "When a Sheet row is added, draft a follow-up email and ask me for approval",
];

function ProposalCard({
  message,
  onApply,
}: {
  message: BuildChatMessage;
  onApply: (message: BuildChatMessage) => void;
}) {
  const proposal = message.proposal;
  if (!proposal) return null;
  const steps = (proposal.nodes as Array<{ label?: string; type?: string }>).map(
    (node) => node.label || node.type || "Step",
  );
  return (
    <div className="chat-proposal">
      <div className="chat-proposal-head">
        <Sparkles size={13} aria-hidden="true" />
        <strong>{proposal.name || "Proposed workflow"}</strong>
      </div>
      {proposal.description && <p className="t-small t-muted">{proposal.description}</p>}
      <ol className="chat-proposal-steps">
        {steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <p className="t-small t-muted">
        {proposal.nodes.length} step{proposal.nodes.length === 1 ? "" : "s"} · {proposal.edges.length}{" "}
        connection{proposal.edges.length === 1 ? "" : "s"} · replaces the current canvas
      </p>
      {message.appliedAt ? (
        <span className="chat-proposal-applied">
          <Check size={12} aria-hidden="true" /> Applied to canvas
        </span>
      ) : (
        <button type="button" className="btn btn-primary" onClick={() => onApply(message)}>
          Apply to canvas
        </button>
      )}
    </div>
  );
}

type BuildChatQuestions = NonNullable<BuildChatMessage["questions"]>;

/* Option chips for the assistant's clarifying questions. One submission per round. */
function QuestionsCard({
  questions,
  disabled,
  onSubmit,
}: {
  questions: BuildChatQuestions;
  disabled: boolean;
  onSubmit: (answer: string) => void;
}) {
  const [selected, setSelected] = useState<Record<string, string[]>>({});

  const toggle = (question: BuildChatQuestions[number], optionId: string) => {
    setSelected((previous) => {
      const current = previous[question.id] ?? [];
      if (question.allowMultiple) {
        return {
          ...previous,
          [question.id]: current.includes(optionId)
            ? current.filter((id) => id !== optionId)
            : [...current, optionId],
        };
      }
      return { ...previous, [question.id]: current.includes(optionId) ? [] : [optionId] };
    });
  };

  const answered = questions.flatMap((question) => {
    const chosen = new Set(selected[question.id] ?? []);
    if (chosen.size === 0) return [];
    const labels = question.options.flatMap((option) => chosen.has(option.id) ? [option.label] : []);
    return [{ prompt: question.prompt, labels }];
  });
  const compose = () =>
    answered
      .map((answer) => `${answer.prompt} → ${answer.labels.join(", ")}`)
      .join("\n");

  return (
    <div className="chat-questions">
      {questions.map((question) => {
        const selectedOptions = new Set(selected[question.id] ?? []);
        return <div className="chat-question" key={question.id}>
          <p className="t-small">{question.prompt}</p>
          <div className="chip-row">
            {question.options.map((option) => {
              const isSelected = selectedOptions.has(option.id);
              return (
                <button
                  key={option.id}
                  type="button"
                  className={`chip ${isSelected ? "is-selected" : ""}`}
                  disabled={disabled}
                  aria-pressed={isSelected}
                  onClick={() => toggle(question, option.id)}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>;
      })}
      {!disabled && (
        <button
          type="button"
          className="btn btn-primary"
          disabled={answered.length === 0}
          onClick={() => onSubmit(compose())}
        >
          Send answers
        </button>
      )}
    </div>
  );
}

export function BuildChat({ workflowExternalId, getGraph, onApply }: BuildChatProps) {
  const [messages, setMessages] = useState<BuildChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const scrollRef = useRef<HTMLDivElement>(null);
  const latestMessageStatus = messages.at(-1)?.status;

  useEffect(() => {
    if (!convexClient) return;
    const watch = convexClient.watchQuery(listBuildChatMessagesRef, { workflowExternalId });
    const unsubscribe = watch.onUpdate(() => {
      try {
        const result = watch.localQueryResult();
        if (result) setMessages(result);
      } catch {
        // Query errors (e.g. signed out) leave the previous list in place.
      }
    });
    return unsubscribe;
  }, [workflowExternalId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages.length, latestMessageStatus]);

  const send = async (content: string) => {
    if (!convexClient || sending) return;
    const text = content.trim();
    if (!text) return;
    setSending(true);
    setError(undefined);
    try {
      await convexClient.mutation(sendBuildChatMessageRef, {
        workflowExternalId,
        content: text,
        graph: getGraph(),
      });
      setDraft("");
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : "Could not send that message.");
    } finally {
      setSending(false);
    }
  };

  if (!convexClient) {
    return (
      <div className="tx-empty">
        <p className="t-heading">Build chat needs the backend</p>
        <p className="t-small t-muted">Configure VITE_CONVEX_URL to describe workflows in chat.</p>
      </div>
    );
  }

  return (
    <div className="build-chat">
      <div className="build-chat-messages" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="tx-empty">
            <p className="t-heading">Describe the workflow you want</p>
            <p className="t-small t-muted">
              The assistant proposes a workflow you can review, then apply to the canvas.
            </p>
            <div className="build-chat-starters">
              {STARTERS.map((starter) => (
                <button key={starter} type="button" className="chip" onClick={() => void send(starter)}>
                  {starter}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((message, index) => (
          <div key={message._id} className={`chat-message chat-message-${message.role}`}>
            {message.status === "pending" ? (
              <span className="chat-thinking">
                <Loader2 className="spin" size={13} aria-hidden="true" /> Designing…
              </span>
            ) : (
              <>
                {message.content && (
                  <p className={message.status === "failed" ? "chat-error" : undefined}>{message.content}</p>
                )}
                {message.proposal && <ProposalCard message={message} onApply={onApply} />}
                {message.questions && message.questions.length > 0 && (
                  <QuestionsCard
                    questions={message.questions}
                    disabled={index !== messages.length - 1 || sending}
                    onSubmit={(answer) => void send(answer)}
                  />
                )}
              </>
            )}
          </div>
        ))}
      </div>
      {error && <p className="chat-error t-small">{error}</p>}
      <form
        className="build-chat-composer"
        onSubmit={(event) => {
          event.preventDefault();
          void send(draft);
        }}
      >
        <label className="sr-only" htmlFor="build-chat-draft">Workflow request</label>
        <textarea
          id="build-chat-draft"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Describe the workflow you want, or ask to change the current one…"
          rows={3}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void send(draft);
            }
          }}
        />
        <button type="submit" className="btn btn-primary" disabled={sending || !draft.trim()}>
          {sending ? <Loader2 className="spin" size={13} /> : <Send size={13} />} Send
        </button>
      </form>
    </div>
  );
}
