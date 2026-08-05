import { ChevronRight, GripVertical, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { NODE_CATALOG } from "../catalog";
import type { NodeCategory, WorkflowNodeType } from "../types";
import { NODE_ICONS } from "./icons";

const categories: NodeCategory[] = ["Triggers", "AI", "Logic", "Actions"];

interface NodePaletteProps {
  onAdd: (type: WorkflowNodeType) => void;
}

export function NodePalette({ onAdd }: NodePaletteProps) {
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
    <aside className="palette panel">
      <div className="panel-heading">
        <span>Blocks</span>
        <small>{NODE_CATALOG.length}</small>
      </div>
      <label className="search-box">
        <Search size={15} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a block" />
      </label>
      <div className="palette-scroll">
        {categories.map((category) => {
          const items = filtered.filter((item) => item.category === category);
          if (items.length === 0) return null;
          return (
            <section key={category} className="palette-group">
              <div className="palette-category">
                <ChevronRight size={13} />
                {category}
              </div>
              {items.map((item) => {
                const Icon = NODE_ICONS[item.type];
                return (
                  <button
                    className="palette-item"
                    key={item.type}
                    draggable
                    onDragStart={(event) => startDrag(event, item.type)}
                    onClick={() => onAdd(item.type)}
                  >
                    <GripVertical className="drag-grip" size={13} />
                    <span className="palette-icon" style={{ color: item.accent }}>
                      <Icon size={16} />
                    </span>
                    <span>
                      <strong>{item.label}</strong>
                      <small>{item.description}</small>
                    </span>
                  </button>
                );
              })}
            </section>
          );
        })}
      </div>
      <div className="palette-foot">
        <span className="safe-dot" /> Fixed blocks only
        <small>No arbitrary code</small>
      </div>
    </aside>
  );
}
