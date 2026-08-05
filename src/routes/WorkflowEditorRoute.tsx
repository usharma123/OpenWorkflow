import { ReactFlowProvider } from "@xyflow/react";
import { useParams } from "react-router-dom";
import "@xyflow/react/dist/style.css";
import App from "../App";

export default function WorkflowEditorRoute() {
  const { workflowId } = useParams<{ workflowId: string }>();
  return (
    <ReactFlowProvider key={workflowId}>
      <App />
    </ReactFlowProvider>
  );
}
