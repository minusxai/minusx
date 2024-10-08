import { InternalState } from "../base/defaultState";
import {
  DEFAULT_PLANNER_SYSTEM_PROMPT,
  DEFAULT_PLANNER_USER_PROMPT,
  ACTION_DESCRIPTIONS_PLANNER,
} from "./prompts"
import {
    DEFAULT_SUGGESTIONS_SYSTEM_PROMPT,
    DEFAULT_SUGGESTIONS_USER_PROMPT,
} from "../jupyter/prompts";

export const googleSheetInternalState: InternalState = {
  isEnabled: {
    value: true,
    reason: "",
  },
  llmConfigs: {
    default: {
      type: "simple",
      llmSettings: {
        model: "gpt-4o",
        temperature: 0,
        response_format: { type: "text" },
        tool_choice: "required",
      },
      systemPrompt: DEFAULT_PLANNER_SYSTEM_PROMPT,
      userPrompt: DEFAULT_PLANNER_USER_PROMPT,
      actionDescriptions: ACTION_DESCRIPTIONS_PLANNER,
    },
    suggestions: {
      type: "simple",
      llmSettings: {
        model: "gpt-4o-mini",
        temperature: 0,
        response_format: {
          type: "json_object",
        },
        tool_choice: "none",
      },
      systemPrompt: DEFAULT_SUGGESTIONS_SYSTEM_PROMPT,
      userPrompt: DEFAULT_SUGGESTIONS_USER_PROMPT,
      actionDescriptions: [],
    },
  },
  querySelectorMap: {},
};