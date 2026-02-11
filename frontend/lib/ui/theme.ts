import { createSystem, defaultConfig, defineConfig, defineRecipe } from "@chakra-ui/react"

const buttonRecipe = defineRecipe({
  base: {
    fontFamily: 'mono',
  },
  variants: {
    variant: {
      danger: {
        bg: 'accent.danger',
        color: 'white',
        _hover: {
          opacity: 0.9,
        },
      },
      teal: {
        bg: 'accent.teal',
        color: 'white',
        _hover: {
          opacity: 0.9,
        },
      },
      secondary: {
        bg: 'accent.secondary',
        color: 'white',
        _hover: {
          opacity: 0.9,
        },
      },
    },
  },
})

const iconButtonRecipe = defineRecipe({
  variants: {
    variant: {
      danger: {
        bg: 'accent.danger',
        color: 'white',
        _hover: {
          opacity: 0.9,
        },
      },
      teal: {
        bg: 'accent.teal',
        color: 'white',
        _hover: {
          opacity: 0.9,
        },
      },
      secondary: {
        bg: 'accent.secondary',
        color: 'white',
        _hover: {
          opacity: 0.9,
        },
      },
    },
  },
})

const customConfig = defineConfig({
  globalCss: {
    body: {
      fontFamily: 'var(--font-inter)',
      bg: 'bg.canvas',
      color: 'fg.default',
    },
  },
  theme: {
    tokens: {
      fonts: {
        heading: { value: 'var(--font-inter)' },
        body: { value: 'var(--font-inter)' },
        mono: { value: 'var(--font-jetbrains-mono)' },
      },
      colors: {
        // Light mode colors
        light: {
          bg: {
            canvas: { value: '#F5F7FA' },      // Slightly darker base
            surface: { value: '#FFFFFF' },     // White for cards/content
            elevated: { value: '#FFFFFF' },    // White for elevated elements
            muted: { value: '#E8ECEF' },       // More distinct for sidebars/headers
            subtle: { value: '#F0F3F6' },      // For hover states
            emphasis: { value: '#D8DDE3' },    // Ashy gray for emphasis/highlights
          },
          fg: {
            default: { value: '#0D1117' },
            muted: { value: '#57606A' },
            subtle: { value: '#8B949E' },
            emphasized: { value: '#24292F' },  // For strong emphasis
          },
          border: {
            default: { value: '#D0D7DE' },
            muted: { value: '#E5E9ED' },
            emphasized: { value: '#BCC4CC' },  // Stronger borders
          },
          accent: {
            primary: { value: '#2980b9' },        // Belize Hole (darker blue)
            primaryHover: { value: '#1f6391' },   // Even darker blue
            secondary: { value: '#9b59b6' },      // Amethyst (purple)
            secondaryHover: { value: '#8e44ad' }, // Wisteria (darker purple)
            success: { value: '#2ecc71' },        // Emerald (green)
            warning: { value: '#f39c12' },        // Orange
            danger: { value: '#c0392b' },         // Pomegranate (darker red)
            teal: { value: '#16a085' },           // Green Sea (teal)
            info: { value: '#3498db' },        // Info (lighter blue)
            infoHover: { value: '#2c81b6' },   // Info hover
            cyan: { value: '#1abc9c' },        // Turquoise (cyan)
            muted: { value: '#7f8c8d' },       // Muted gray
            mutedHover: { value: '#6c7b7c' },  // Muted hover
          },
        },
        // Dark mode colors
        dark: {
          bg: {
            canvas: { value: '#0D1117' },
            surface: { value: '#161B22' },
            elevated: { value: '#1C2128' },
            muted: { value: '#21262D' },       // Lighter for sidebars/headers
            subtle: { value: '#181D24' },      // For hover states
            emphasis: { value: '#454D56' },    // Lighter for emphasis/highlights
          },
          fg: {
            default: { value: '#E6EDF3' },
            muted: { value: '#8B949E' },
            subtle: { value: '#6E7681' },
            emphasized: { value: '#F0F6FC' },  // Brighter for emphasis
          },
          border: {
            default: { value: '#30363D' },
            muted: { value: '#21262D' },
            emphasized: { value: '#3D444D' },  // Stronger borders
          },
          accent: {
            primary: { value: '#2980b9' },        // Belize Hole (darker blue)
            primaryHover: { value: '#1f6391' },   // Even darker blue
            secondary: { value: '#9b59b6' },      // Amethyst (purple)
            secondaryHover: { value: '#8e44ad' }, // Wisteria (darker purple)
            success: { value: '#2ecc71' },        // Emerald (green)
            warning: { value: '#f39c12' },        // Orange
            danger: { value: '#c0392b' },         // Pomegranate (darker red)
            teal: { value: '#16a085' },           // Green Sea (teal)
            cyan: { value: '#1abc9c' },           // Turquoise (cyan)
            muted: { value: '#7f8c8d' },          // Muted gray
            mutedHover: { value: '#6c7b7c' },     // Muted hover
          },
        },
      },
      shadows: {
        light: {
          sm: { value: '0 1px 2px 0 rgba(13, 17, 23, 0.04)' },
          md: { value: '0 4px 6px -1px rgba(13, 17, 23, 0.08), 0 2px 4px -2px rgba(13, 17, 23, 0.05)' },
          lg: { value: '0 10px 15px -3px rgba(13, 17, 23, 0.08), 0 4px 6px -4px rgba(13, 17, 23, 0.05)' },
          xl: { value: '0 20px 25px -5px rgba(13, 17, 23, 0.08), 0 8px 10px -6px rgba(13, 17, 23, 0.05)' },
        },
        dark: {
          sm: { value: '0 1px 2px 0 rgba(0, 0, 0, 0.3)' },
          md: { value: '0 4px 6px -1px rgba(0, 0, 0, 0.4), 0 2px 4px -2px rgba(0, 0, 0, 0.3)' },
          lg: { value: '0 10px 15px -3px rgba(0, 0, 0, 0.4), 0 4px 6px -4px rgba(0, 0, 0, 0.3)' },
          xl: { value: '0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.4)' },
        },
      },
    },
    semanticTokens: {
      colors: {
        'bg.canvas': {
          value: { _light: '{colors.light.bg.canvas}', _dark: '{colors.dark.bg.canvas}' },
        },
        'bg.surface': {
          value: { _light: '{colors.light.bg.surface}', _dark: '{colors.dark.bg.surface}' },
        },
        'bg.elevated': {
          value: { _light: '{colors.light.bg.elevated}', _dark: '{colors.dark.bg.elevated}' },
        },
        'bg.muted': {
          value: { _light: '{colors.light.bg.muted}', _dark: '{colors.dark.bg.muted}' },
        },
        'bg.subtle': {
          value: { _light: '{colors.light.bg.subtle}', _dark: '{colors.dark.bg.subtle}' },
        },
        'bg.emphasis': {
          value: { _light: '{colors.light.bg.emphasis}', _dark: '{colors.dark.bg.emphasis}' },
        },
        'fg.default': {
          value: { _light: '{colors.light.fg.default}', _dark: '{colors.dark.fg.default}' },
        },
        'fg.muted': {
          value: { _light: '{colors.light.fg.muted}', _dark: '{colors.dark.fg.muted}' },
        },
        'fg.subtle': {
          value: { _light: '{colors.light.fg.subtle}', _dark: '{colors.dark.fg.subtle}' },
        },
        'fg.emphasized': {
          value: { _light: '{colors.light.fg.emphasized}', _dark: '{colors.dark.fg.emphasized}' },
        },
        'border.default': {
          value: { _light: '{colors.light.border.default}', _dark: '{colors.dark.border.default}' },
        },
        'border.muted': {
          value: { _light: '{colors.light.border.muted}', _dark: '{colors.dark.border.muted}' },
        },
        'border.emphasized': {
          value: { _light: '{colors.light.border.emphasized}', _dark: '{colors.dark.border.emphasized}' },
        },
        'accent.primary': {
          value: { _light: '{colors.light.accent.primary}', _dark: '{colors.dark.accent.primary}' },
        },
        'accent.primaryHover': {
          value: { _light: '{colors.light.accent.primaryHover}', _dark: '{colors.dark.accent.primaryHover}' },
        },
        'accent.secondary': {
          value: { _light: '{colors.light.accent.secondary}', _dark: '{colors.dark.accent.secondary}' },
        },
        'accent.secondaryHover': {
          value: { _light: '{colors.light.accent.secondaryHover}', _dark: '{colors.dark.accent.secondaryHover}' },
        },
        'accent.success': {
          value: { _light: '{colors.light.accent.success}', _dark: '{colors.dark.accent.success}' },
        },
        'accent.warning': {
          value: { _light: '{colors.light.accent.warning}', _dark: '{colors.dark.accent.warning}' },
        },
        'accent.danger': {
          value: { _light: '{colors.light.accent.danger}', _dark: '{colors.dark.accent.danger}' },
        },
        'accent.teal': {
          value: { _light: '{colors.light.accent.teal}', _dark: '{colors.dark.accent.teal}' },
        },
        'accent.cyan': {
          value: { _light: '{colors.light.accent.cyan}', _dark: '{colors.dark.accent.cyan}' },
        },
        'accent.muted': {
          value: { _light: '{colors.light.accent.muted}', _dark: '{colors.dark.accent.muted}' },
        },
      },
      shadows: {
        sm: {
          value: { _light: '{shadows.light.sm}', _dark: '{shadows.dark.sm}' },
        },
        md: {
          value: { _light: '{shadows.light.md}', _dark: '{shadows.dark.md}' },
        },
        lg: {
          value: { _light: '{shadows.light.lg}', _dark: '{shadows.dark.lg}' },
        },
        xl: {
          value: { _light: '{shadows.light.xl}', _dark: '{shadows.dark.xl}' },
        },
      },
    },
    recipes: {
      button: buttonRecipe,
      iconButton: iconButtonRecipe,
    },
  },
})

export const system = createSystem(defaultConfig, customConfig)
