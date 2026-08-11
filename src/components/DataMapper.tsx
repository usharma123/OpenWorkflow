import { Braces, Check, Plus } from "lucide-react";
import { useState } from "react";
import {
  appendMappingExpression,
  mappingExpression,
  mappingTargetsFor,
  type MappingSource,
} from "../lib/dataMapping";
import type { WorkflowNode } from "../types";

interface DataMapperProps {
  node: WorkflowNode;
  sources: MappingSource[];
  onChange: (node: WorkflowNode) => void;
}

export function DataMapper({ node, sources, onChange }: DataMapperProps) {
  const targets = mappingTargetsFor(node.data.nodeType);
  const [targetKey, setTargetKey] = useState(targets[0]?.key ?? "");
  const [lastInserted, setLastInserted] = useState<string>();

  if (!targets.length) return null;
  const target = targets.find((candidate) => candidate.key === targetKey) ?? targets[0];

  const insert = (source: MappingSource, path: string) => {
    const expression = mappingExpression(source.nodeId, path);
    const current = String(node.data.config[target.key] ?? "");
    onChange({
      ...node,
      data: {
        ...node.data,
        config: {
          ...node.data.config,
          [target.key]: appendMappingExpression(current, expression, target.multiline),
        },
      },
    });
    setLastInserted(expression);
  };

  return (
    <section className="inspector-section data-mapper">
      <div className="mapper-heading">
        <span className="t-eyebrow">Input data</span>
        <Braces size={15} aria-hidden="true" />
      </div>
      <p className="mapper-help">Insert output from an earlier step into this step.</p>

      <label className="field mapper-target">
        <span>Insert into</span>
        <select value={target.key} onChange={(event) => {
          setTargetKey(event.target.value);
          setLastInserted(undefined);
        }}>
          {targets.map((candidate) => (
            <option key={candidate.key} value={candidate.key}>{candidate.label}</option>
          ))}
        </select>
      </label>

      {sources.length ? (
        <div className="mapper-sources">
          {sources.map((source) => (
            <details className="mapper-source" key={source.nodeId} open>
              <summary>
                <span>
                  <strong>{source.nodeLabel}</strong>
                  <small>{source.pinned ? "Pinned sample" : source.nodeType}</small>
                </span>
                <small>{source.fields.length} fields</small>
              </summary>
              <div className="mapper-fields">
                {source.fields.map((field) => {
                  const expression = mappingExpression(source.nodeId, field.path);
                  return (
                    <button
                      type="button"
                      className="mapper-field"
                      key={field.path || "$output"}
                      onClick={() => insert(source, field.path)}
                      title={`Insert ${expression}`}
                    >
                      <span>
                        <code>{field.label}</code>
                        <small>{field.preview}</small>
                      </span>
                      <Plus size={13} aria-hidden="true" />
                    </button>
                  );
                })}
              </div>
              <details className="mapper-raw">
                <summary>Raw output</summary>
                <pre>{JSON.stringify(source.output, null, 2)}</pre>
              </details>
            </details>
          ))}
        </div>
      ) : (
        <div className="mapper-empty">
          Run an upstream step or pin sample output, then return here to map its fields.
        </div>
      )}

      {lastInserted && (
        <div className="mapper-inserted" role="status">
          <Check size={13} aria-hidden="true" />
          <span>Inserted <code>{lastInserted}</code></span>
        </div>
      )}
    </section>
  );
}
