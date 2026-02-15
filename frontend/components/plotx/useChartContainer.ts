import { useRef, useState, useEffect, useMemo } from 'react'

export function useChartContainer(onChartClick?: (params: unknown) => void) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState<number | undefined>(undefined)
  const [containerHeight, setContainerHeight] = useState<number | undefined>(undefined)

  // Stable click handler via ref so EChart's one-time event binding always calls the latest callback
  const onClickRef = useRef(onChartClick)
  useEffect(() => { onClickRef.current = onChartClick })
  const chartEvents = useMemo(() => ({
    click: (params: unknown) => onClickRef.current?.(params),
  }), [])

  // Measure container dimensions
  useEffect(() => {
    if (!containerRef.current) return

    const updateDimensions = () => {
      if (containerRef.current) {
        const newWidth = containerRef.current.offsetWidth
        const newHeight = containerRef.current.offsetHeight
        if (newWidth > 0) setContainerWidth(newWidth)
        if (newHeight > 0) setContainerHeight(newHeight)
      }
    }

    // Immediate measurement
    updateDimensions()

    // Use ResizeObserver for dynamic changes
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        if (width > 0) setContainerWidth(width)
        if (height > 0) setContainerHeight(height)
      }
    })

    resizeObserver.observe(containerRef.current)

    return () => {
      resizeObserver.disconnect()
    }
  }, [])

  return { containerRef, containerWidth, containerHeight, chartEvents }
}
