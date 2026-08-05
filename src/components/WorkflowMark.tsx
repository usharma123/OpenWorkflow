/*
 * Product mark: two connected nodes at a single stroke weight. Monochrome by
 * design — the gradient tile it replaces was the loudest object in the app.
 */
export function WorkflowMark({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="2.5" y="3.5" width="7" height="6" rx="2" />
      <rect x="14.5" y="14.5" width="7" height="6" rx="2" />
      <path d="M9.5 6.5h4.5a3 3 0 0 1 3 3v5" />
    </svg>
  );
}
