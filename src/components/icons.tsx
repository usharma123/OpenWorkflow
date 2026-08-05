import {
  Bot,
  Braces,
  CheckCircle2,
  Clock3,
  FileText,
  GitBranch,
  Globe2,
  Hand,
  Mail,
  Play,
  Radio,
  Send,
  Slack,
  type LucideIcon,
} from "lucide-react";
import type { WorkflowNodeType } from "../types";

export const NODE_ICONS: Record<WorkflowNodeType, LucideIcon> = {
  manualTrigger: Play,
  webhookTrigger: Radio,
  scheduleTrigger: Clock3,
  gmailTrigger: Mail,
  ai: Bot,
  googleDoc: FileText,
  slack: Slack,
  http: Globe2,
  condition: GitBranch,
  transform: Braces,
  delay: Clock3,
  approval: Hand,
  output: Send,
};

export { CheckCircle2 };
