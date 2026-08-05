import { CheckCircle2, CircleAlert, Clock3, Terminal, X } from "lucide-react";
import type { RunLog } from "../types";

interface RunPanelProps {
  logs: RunLog[];
  running: boolean;
  onClose: () => void;
}

export function RunPanel({ logs, running, onClose }: RunPanelProps) {
  return (
    <section className="run-panel">
      <div className="run-panel-head">
        <div><Terminal size={15} /><strong>Run output</strong><span className={running ? "run-live" : "run-done"}>{running ? "Running" : "Finished"}</span></div>
        <button className="icon-button" onClick={onClose}><X size={16} /></button>
      </div>
      <div className="run-logs">
        {logs.length === 0 && <p>Logs will appear here when the workflow starts.</p>}
        {logs.map((log) => (
          <div className={`run-log ${log.level}`} key={log.id}>
            {log.level === "success" ? <CheckCircle2 size={14} /> : log.level === "error" ? <CircleAlert size={14} /> : <Clock3 size={14} />}
            <time>{new Date(log.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time>
            <span>{log.message}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
