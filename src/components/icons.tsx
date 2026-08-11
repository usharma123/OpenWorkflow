import {
  Bot,
  Braces,
  Clock3,
  CalendarDays,
  Combine,
  Container,
  FileCode2,
  FileClock,
  GitFork,
  GitBranch,
  Globe2,
  Play,
  Radio,
  Repeat2,
  Send,
  Terminal,
  TableProperties,
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
  gmailEventTrigger: GmailMark,
  googleDoc: GoogleDocsMark,
  slack: SlackMark,
};

const GLYPHS: Record<WorkflowNodeType, LucideIcon> = {
  manualTrigger: Play,
  webhookTrigger: Radio,
  scheduleTrigger: Clock3,
  gmailTrigger: Bot,
  gmailEventTrigger: Bot,
  calendarTrigger: CalendarDays,
  driveTrigger: FileClock,
  sheetsTrigger: TableProperties,
  ai: Bot,
  googleDoc: Bot,
  slack: Bot,
  http: Globe2,
  condition: GitBranch,
  transform: Braces,
  forEach: Repeat2,
  merge: Combine,
  delay: Clock3,
  approval: UserCheck,
  daytonaSandbox: Container,
  code: FileCode2,
  shell: Terminal,
  git: GitFork,
  output: Send,
};

export function NodeMark({ type, size = 18 }: { type: WorkflowNodeType; size?: number }) {
  const Brand = BRAND_MARKS[type];
  if (Brand) return <Brand size={size} />;
  const Glyph = GLYPHS[type];
  return <Glyph size={size} strokeWidth={1.6} />;
}
