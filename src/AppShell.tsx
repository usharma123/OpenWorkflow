import { UserButton } from "@clerk/react";
import { CircleAlert, Check, History, Plug, Settings, Workflow } from "lucide-react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { WorkflowMark } from "./components/WorkflowMark";
import { useConnections } from "./lib/connections";
import { GOOGLE_SCOPES } from "./lib/googleAuth";

const NAV = [
  { to: "/workflows", label: "Workflows", Icon: Workflow },
  { to: "/runs", label: "Runs", Icon: History },
  { to: "/connections", label: "Connections", Icon: Plug },
  { to: "/settings", label: "Settings", Icon: Settings },
];

export function AppShell() {
  const { notice } = useConnections();
  const location = useLocation();

  return (
    <div className="app">
      <nav className="rail" aria-label="Primary">
        <span className="rail-mark" title="OpenWorkflow">
          <WorkflowMark size={19} />
        </span>

        {NAV.map(({ to, label, Icon }) => (
          <NavLink
            key={to}
            to={to}
            data-label={label}
            aria-label={label}
            className={({ isActive }) =>
              `rail-link ${isActive || (to === "/workflows" && location.pathname.startsWith("/workflow/")) ? "is-active" : ""}`
            }
          >
            <Icon size={17} strokeWidth={1.7} />
          </NavLink>
        ))}

        <div className="rail-foot">
          <UserButton userProfileProps={{ additionalOAuthScopes: { google: GOOGLE_SCOPES } }} />
        </div>
      </nav>

      <Outlet />

      {notice && (
        <div className={`toast ${notice.tone === "error" ? "is-error" : ""}`} role="status">
          {notice.tone === "error" ? <CircleAlert size={15} /> : <Check size={15} />}
          {notice.message}
        </div>
      )}
    </div>
  );
}

/* Non-canvas routes share one scrolling frame with a title bar. */
export function PageFrame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="route">
      <header className="topbar">
        <div className="topbar-title">
          <strong className="t-heading">{title}</strong>
        </div>
      </header>
      <div className="route-body">{children}</div>
    </div>
  );
}
