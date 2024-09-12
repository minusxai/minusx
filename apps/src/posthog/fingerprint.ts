import { ToolMatcher } from "extension";

export const posthogFingerprintMatcher: ToolMatcher = {
  default: {
    type: "combination",
    or: [
      {
        type: "domQueryCondition",
        domQuery: {
          selector: {
            type: "XPATH",
            selector: "//title[text()=\"PostHog\"]",
          },
        },
      },
    ],
  },
};
