/**
 * Shared CSS keyframe animations used across the app.
 * Extracted from ThinkingIndicator and HelloWorldContent to avoid duplication.
 */

/** Pulsing dots animation (opacity + scale) */
export const pulseKeyframes = `
  @keyframes pulse {
    0%, 100% { opacity: 0.3; transform: scale(1); }
    50% { opacity: 1; transform: scale(1.2); }
  }
`;

/** Sparkle icon animation (rotation + scale) */
export const sparkleKeyframes = `
  @keyframes sparkle {
    0%, 100% { transform: rotate(0deg) scale(1); }
    25% { transform: rotate(-10deg) scale(1.1); }
    50% { transform: rotate(10deg) scale(0.9); }
    75% { transform: rotate(-5deg) scale(1.05); }
  }
`;

/** Fade-in from below animation */
export const fadeInUpKeyframes = `
  @keyframes fadeInUp {
    from {
      opacity: 0;
      transform: translateY(20px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
`;

/** Rotating conic-gradient border */
export const rotateBorderKeyframes = `
  @property --border-angle {
    syntax: '<angle>';
    initial-value: 0deg;
    inherits: false;
  }

  @keyframes rotateBorder {
    from { --border-angle: 0deg; }
    to { --border-angle: 360deg; }
  }
`;

/** Typewriter cursor blink */
export const cursorBlinkKeyframes = `
  @keyframes cursorBlink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0; }
  }
`;
