import {
  Bot,
  Braces,
  CheckCircle2,
  Clock3,
  GitBranch,
  Globe2,
  Play,
  Radio,
  Send,
  UserCheck,
  type LucideIcon,
} from "lucide-react";
import type { ReactElement } from "react";
import type { WorkflowNodeType } from "../types";
import { GmailMark, GoogleDocsMark, SlackMark } from "./BrandMarks";

/*
 * Steps backed by a real product render that product's own mark. Everything
 * else renders a monochrome lucide glyph, so colour on the canvas always means
 * "this step talks to that service".
 */
const BRAND_MARKS: Partial<Record<WorkflowNodeType, (props: { size?: number }) => ReactElement>> = {
  gmailTrigger: GmailMark,
  googleDoc: GoogleDocsMark,
  slack: SlackMark,
};

const GLYPHS: Record<WorkflowNodeType, LucideIcon> = {
  manualTrigger: Play,
  webhookTrigger: Radio,
  scheduleTrigger: Clock3,
  gmailTrigger: Bot,
  ai: Bot,
  googleDoc: Bot,
  slack: Bot,
  http: Globe2,
  condition: GitBranch,
  transform: Braces,
  delay: Clock3,
  approval: UserCheck,
  output: Send,
};

export function hasBrandMark(type: WorkflowNodeType): boolean {
  return type in BRAND_MARKS;
}

export function NodeMark({ type, size = 18 }: { type: WorkflowNodeType; size?: number }) {
  const Brand = BRAND_MARKS[type];
  if (Brand) return <Brand size={size} />;
  const Glyph = GLYPHS[type];
  return <Glyph size={size} strokeWidth={1.6} />;
}

export const NODE_ICONS = GLYPHS;
export { CheckCircle2 };
