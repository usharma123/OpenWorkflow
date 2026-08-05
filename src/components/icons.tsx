import {
  Bot,
  Braces,
  CheckCircle2,
  Clock3,
  GitBranch,
  Globe2,
  Hand,
  Play,
  Radio,
  Send,
  type LucideIcon,
} from "lucide-react";
import type { WorkflowNodeType } from "../types";

export const NODE_ICONS: Record<WorkflowNodeType, LucideIcon> = {
  manualTrigger: Play,
  webhookTrigger: Radio,
  scheduleTrigger: Clock3,
  ai: Bot,
  http: Globe2,
  condition: GitBranch,
  transform: Braces,
  delay: Clock3,
  approval: Hand,
  output: Send,
};

export { CheckCircle2 };
