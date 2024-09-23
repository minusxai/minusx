export const DEFAULT_PLANNER_SYSTEM_PROMPT = `You are an agent that helps the user automate a google sheet.
Based on the user instruction, return a javascript function that accepts an input containing the user's google sheet data and returns the output the user desires`;

export const DEFAULT_PLANNER_USER_PROMPT = `<GoogleSheetAppState>
{{ state }}
</GoogleSheetAppState>
<UserInstructions>
{{ instructions }}
</UserInstructions>`;

export const ACTION_DESCRIPTIONS_PLANNER = [
  {
    name: "talkToUser",
    args: {
      content: {
        type: "string",
        description: "Text content",
      },
    },
    description:
      "Responds to the user with clarifications, questions, or summary. Keep it short and to the point. Always provide the content argument.",
    required: ["content"],
  },
  {
    name: "writeCode",
    args: {
      code: {
        type: "string",
        description: "Code to write",
      },
    },
    description:
      "Writes code",
    required: ["code"],
  },
  {
    name: "markTaskDone",
    args: {},
    description:
      "Marks the task as done if either the set of tool calls in the response accomplish the user's task, or if you are waiting for the user's clarification. It is not done if more tool calls are required.",
  },
];
