'use client';

import { getArrow } from 'perfect-arrows';
import type { Arrow, Rectangle } from '@/lib/types';

interface ArrowPathProps {
  arrow: Arrow;
  rectangles: Rectangle[];
  isSelected: boolean;
  onSelect: () => void;
}

function getAnchorPoint(rect: Rectangle, anchor: string) {
  const { x, y, width, height } = rect;

  switch (anchor) {
    case 'top':
      return { x: x + width / 2, y };
    case 'right':
      return { x: x + width, y: y + height / 2 };
    case 'bottom':
      return { x: x + width / 2, y: y + height };
    case 'left':
      return { x, y: y + height / 2 };
    case 'center':
    default:
      return { x: x + width / 2, y: y + height / 2 };
  }
}

export default function ArrowPath({ arrow, rectangles, isSelected, onSelect }: ArrowPathProps) {
  const fromRect = rectangles.find((r) => r.id === arrow.fromId);
  const toRect = rectangles.find((r) => r.id === arrow.toId);

  if (!fromRect || !toRect) return null;

  const fromPoint = getAnchorPoint(fromRect, arrow.fromAnchor);
  const toPoint = getAnchorPoint(toRect, arrow.toAnchor);

  const arrowData = getArrow(
    fromPoint.x,
    fromPoint.y,
    toPoint.x,
    toPoint.y,
    {
      padStart: 10,
      padEnd: 10,
    }
  );

  const [sx, sy, cx, cy, ex, ey, ae] = arrowData;

  // Calculate arrowhead points
  const arrowHeadLength = 10;
  const angle = Math.atan2(ey - cy, ex - cx);
  const arrowPoint1X = ex - arrowHeadLength * Math.cos(angle - Math.PI / 6);
  const arrowPoint1Y = ey - arrowHeadLength * Math.sin(angle - Math.PI / 6);
  const arrowPoint2X = ex - arrowHeadLength * Math.cos(angle + Math.PI / 6);
  const arrowPoint2Y = ey - arrowHeadLength * Math.sin(angle + Math.PI / 6);

  return (
    <g onClick={onSelect} cursor="pointer">
      {/* Invisible wider path for easier clicking */}
      <path
        d={`M ${sx} ${sy} Q ${cx} ${cy} ${ex} ${ey}`}
        stroke="transparent"
        strokeWidth={20}
        fill="none"
      />

      {/* Visible arrow path */}
      <path
        data-arrow-id={arrow.id}
        d={`M ${sx} ${sy} Q ${cx} ${cy} ${ex} ${ey}`}
        stroke={arrow.color}
        strokeWidth={isSelected ? arrow.strokeWidth + 1 : arrow.strokeWidth}
        fill="none"
        opacity={isSelected ? 1 : 0.8}
      />

      {/* Arrowhead */}
      <polygon
        data-arrowhead-id={arrow.id}
        points={`${ex},${ey} ${arrowPoint1X},${arrowPoint1Y} ${arrowPoint2X},${arrowPoint2Y}`}
        fill={arrow.color}
        opacity={isSelected ? 1 : 0.8}
      />

      {/* Start point indicator when selected */}
      {isSelected && (
        <circle cx={sx} cy={sy} r="4" fill={arrow.color} />
      )}
    </g>
  );
}
