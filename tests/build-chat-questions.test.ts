import { describe, expect, test } from "bun:test";
import {
  askUserTool,
  buildChatSystemPrompt,
  MAX_BUILD_QUESTIONS,
  parseBuildQuestions,
} from "../shared/buildChat";

describe("build chat clarifying questions", () => {
  test("parses a well-formed ask_user payload", () => {
    const questions = parseBuildQuestions({
      questions: [
        {
          id: "destination",
          prompt: "Where should the brief go?",
          options: [
            { id: "doc", label: "Google Doc" },
            { id: "slack", label: "Slack" },
          ],
        },
        {
          id: "approval",
          prompt: "Require approval before sharing?",
          allowMultiple: false,
          options: [
            { id: "yes", label: "Require approval" },
            { id: "no", label: "Share immediately" },
          ],
        },
      ],
    });
    expect(questions).toHaveLength(2);
    expect(questions[0]).toEqual({
      id: "destination",
      prompt: "Where should the brief go?",
      options: [
        { id: "doc", label: "Google Doc" },
        { id: "slack", label: "Slack" },
      ],
    });
    expect(questions[1].allowMultiple).toBeUndefined();
  });

  test("keeps allowMultiple only when explicitly true", () => {
    const [question] = parseBuildQuestions({
      questions: [
        {
          id: "channels",
          prompt: "Which channels?",
          allowMultiple: true,
          options: [
            { id: "a", label: "#general" },
            { id: "b", label: "#leadership" },
          ],
        },
      ],
    });
    expect(question.allowMultiple).toBe(true);
  });

  test("clamps to the question limit and fills missing ids", () => {
    const questions = parseBuildQuestions({
      questions: Array.from({ length: 6 }, (_, index) => ({
        prompt: `Question ${index + 1}?`,
        options: [
          { label: "Yes" },
          { label: "No" },
        ],
      })),
    });
    expect(questions).toHaveLength(MAX_BUILD_QUESTIONS);
    expect(questions[0].id).toBe("question-1");
    expect(questions[0].options.map((option) => option.id)).toEqual(["option-1", "option-2"]);
  });

  test("drops questions with fewer than two usable options", () => {
    expect(() =>
      parseBuildQuestions({
        questions: [
          { id: "q", prompt: "Pick one", options: [{ id: "only", label: "Just this" }] },
        ],
      }),
    ).toThrow("usable questions");
    const questions = parseBuildQuestions({
      questions: [
        { id: "bad", prompt: "Pick one", options: [{ label: "" }, { label: "  " }] },
        {
          id: "good",
          prompt: "Schedule?",
          options: [
            { id: "daily", label: "Daily" },
            { id: "weekly", label: "Weekly" },
          ],
        },
      ],
    });
    expect(questions).toHaveLength(1);
    expect(questions[0].id).toBe("good");
  });

  test("rejects unusable payloads", () => {
    expect(() => parseBuildQuestions({})).toThrow("usable questions");
    expect(() => parseBuildQuestions({ questions: "nope" })).toThrow("usable questions");
    expect(() => parseBuildQuestions({ questions: [{ prompt: "  ", options: [] }] })).toThrow(
      "usable questions",
    );
  });

  test("tool schema and prompt mention the question flow", () => {
    expect(askUserTool().function.name).toBe("ask_user");
    const prompt = buildChatSystemPrompt();
    expect(prompt).toContain("ask_user");
    expect(prompt).toContain("Do not add executionMode or simulated connector behavior");
    expect(prompt).toContain("use googleDoc so the result is a native, formatted Google Doc");
    expect(prompt).toContain("planFirst");
  });
});
