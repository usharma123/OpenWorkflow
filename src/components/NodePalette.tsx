import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { NODE_CATALOG } from "../catalog";
import type { NodeCategory, WorkflowNodeType } from "../types";
import { NodeMark } from "./icons";

const CATEGORIES: NodeCategory[] = ["Start", "Think", "Review", "Deliver", "Advanced"];

export function NodePalette({ onAdd }: { onAdd: (type: WorkflowNodeType) => void }) {
  const [query, setQuery] = useState("");
  const normalized = query.trim().toLowerCase();

  const filtered = useMemo(
    () =>
      NODE_CATALOG.filter(
        (item) =>
          !normalized ||
          item.label.toLowerCase().includes(normalized) ||
          item.description.toLowerCase().includes(normalized),
      ),
    [normalized],
  );

  const startDrag = (event: React.DragEvent, type: WorkflowNodeType) => {
    event.dataTransfer.setData("application/openworkflow-node", type);
    event.dataTransfer.effectAllowed = "move";
  };

  return (
    <aside className="palette">
      <label className="palette-search">
        <Search size={14} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Find a step"
          aria-label="Find a step"
        />
      </label>

      <div className="palette-scroll">
        {CATEGORIES.map((category) => {
          const items = filtered.filter((item) => item.category === category);
          if (items.length === 0) return null;
          return (
            <section key={category} className="palette-group">
              <span className="t-eyebrow">{category}</span>
              {items.map((item) => (
                <button
                  className="palette-item"
                  key={item.type}
                  draggable
                  onDragStart={(event) => startDrag(event, item.type)}
                  onClick={() => onAdd(item.type)}
                  title={item.outcome}
                >
                  <span className="palette-mark">
                    <NodeMark type={item.type} size={15} />
                  </span>
                  <span>
                    <strong>{item.label}</strong>
                    <small>{item.description}</small>
                  </span>
                </button>
              ))}
            </section>
          );
        })}
        {filtered.length === 0 && <p className="t-small t-muted palette-none">No steps match “{query}”.</p>}
      </div>
    </aside>
  );
}
