import { LuTriangleAlert, LuInfo } from 'react-icons/lu'

interface ChartErrorProps {
  title?: string
  message: string
  variant?: 'warning' | 'info'
}

// App accent palette (Renderer_v2 Phase 5 — kit/Tailwind stack, no Chakra tokens).
const ORANGE = '#f39c12'
const TEAL = '#16a085'
const mix = (color: string, pct: number) => `color-mix(in srgb, ${color} ${pct}%, transparent)`

const VARIANT_STYLES = {
  warning: { color: ORANGE, Icon: LuTriangleAlert },
  info: { color: TEAL, Icon: LuInfo },
} as const

export const ChartError = ({ title, message, variant = 'warning' }: ChartErrorProps) => {
  const style = VARIANT_STYLES[variant]
  const defaultTitle = variant === 'info' ? 'No data to display' : 'Chart configuration error'

  return (
    <div className="flex h-full min-h-[250px] w-full items-center justify-center p-8">
      <div
        className="max-w-[460px] rounded-xl px-8 py-7"
        style={{
          background: mix(style.color, 6),
          border: `1px solid ${mix(style.color, 20)}`,
        }}
      >
        <div className="flex flex-col items-center gap-3 text-center">
          <div
            className="rounded-full p-3 text-xl"
            style={{ background: mix(style.color, 12), color: style.color }}
          >
            <style.Icon />
          </div>
          <span className="font-mono text-lg font-bold text-foreground">
            {title || defaultTitle}
          </span>
          <span className="font-mono text-base leading-relaxed text-muted-foreground">
            {message}
          </span>
        </div>
      </div>
    </div>
  )
}
