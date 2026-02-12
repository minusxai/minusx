'use client';

/**
 * ProductTour Component
 * Renders the product tour for tutorial mode using Shepherd.js
 * Only runs once per user (completion stored in localStorage)
 */

import { useEffect, useState, useRef } from 'react';
import Shepherd from 'shepherd.js';
import type { Tour } from 'shepherd.js';
import { useAppSelector } from '@/store/hooks';
import { useConfigs } from '@/lib/hooks/useConfigs';

const TOUR_COMPLETED_KEY = 'minusx-product-tour-completed';

const isTourCompleted = () => {
  if (typeof window === 'undefined') return true;
  try {
    return localStorage.getItem(TOUR_COMPLETED_KEY) === 'true';
  } catch {
    return false;
  }
};

const markTourCompleted = () => {
  if (typeof window === 'undefined') return;
  localStorage.setItem(TOUR_COMPLETED_KEY, 'true');
};

// Tour step definitions
const TOUR_STEPS = [
  {
    id: 'getting-started',
    title: 'Welcome to Demo Mode!',
    text: 'Complete these items to learn the basics of the platform.',
    element: '[aria-label="Getting Started Section"]',
    position: 'bottom' as const,
  },
  {
    id: 'databases',
    title: 'Manage DB Connections',
    text: 'Easily connect to your databases and manage them in one place.',
    element: '[aria-label="Databases"]',
    position: 'right' as const,
  },
  {
    id: 'explore',
    title: 'Explore!',
    text: 'Free-form space to explore your data and ideate with the agent.',
    element: '[aria-label="Explore"]',
    position: 'top' as const,
  },
  {
    id: 'search-bar',
    title: 'Ask Anything',
    text: 'Use this search bar to quickly ask questions, find files, or chat with {{agentName}}.',
    element: '[aria-label="search-bar"]',
    position: 'top' as const,
  },
];

export default function ProductTour() {
  const user = useAppSelector(state => state.auth.user);
  const isTutorialMode = user?.mode === 'tutorial';
  const { config } = useConfigs();
  const agentName = config.branding.agentName;
  const [isCompleted, setIsCompleted] = useState(() => isTourCompleted());
  const mountedRef = useRef(false);
  const tourRef = useRef<Tour | null>(null);

  useEffect(() => {
    // Guard against StrictMode double-mount
    if (mountedRef.current) return;
    if (!isTutorialMode || isCompleted) return;

    // Load Shepherd CSS
    const linkId = 'shepherd-css';
    if (!document.getElementById(linkId)) {
      const link = document.createElement('link');
      link.id = linkId;
      link.rel = 'stylesheet';
      link.href = 'https://cdn.jsdelivr.net/npm/shepherd.js@13/dist/css/shepherd.css';
      document.head.appendChild(link);
    }

    // Add custom styles
    const styleId = 'minusx-shepherd-styles';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = `
        .shepherd-element {
          background: #1a1a2e !important;
          border: 1px solid #27273a !important;
          border-radius: 12px !important;
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5) !important;
          max-width: 420px !important;
        }
        .shepherd-element .shepherd-content {
          padding: 0 !important;
        }
        .shepherd-element .shepherd-header {
          background: transparent !important;
          padding: 16px 20px 8px !important;
        }
        .shepherd-element .shepherd-title {
          font-family: 'JetBrains Mono', monospace !important;
          font-size: 16px !important;
          font-weight: 600 !important;
          color: #1abc9c !important;
        }
        .shepherd-element .shepherd-cancel-icon {
          color: #71717a !important;
          font-size: 24px !important;
        }
        .shepherd-element .shepherd-cancel-icon:hover {
          color: #a1a1aa !important;
        }
        .shepherd-element .shepherd-text {
          color: #a1a1aa !important;
          font-size: 14px !important;
          line-height: 1.6 !important;
          padding: 0 20px 16px !important;
        }
        .shepherd-element .shepherd-footer {
          padding: 0 20px 16px !important;
          border-top: none !important;
        }
        .shepherd-element .shepherd-button {
          font-family: system-ui !important;
          font-size: 13px !important;
          font-weight: 500 !important;
          border-radius: 6px !important;
          padding: 8px 16px !important;
          transition: all 0.2s !important;
        }
        .shepherd-element .shepherd-button-secondary {
          background: transparent !important;
          color: #a1a1aa !important;
          border: 1px solid #27273a !important;
        }
        .shepherd-element .shepherd-button-secondary:hover {
          background: #27273a !important;
          color: #e4e4e7 !important;
        }
        .shepherd-element .shepherd-button-primary {
          background: #1abc9c !important;
          color: white !important;
          border: none !important;
        }
        .shepherd-element .shepherd-button-primary:hover {
          background: #16a085 !important;
        }
        .shepherd-element .shepherd-arrow::before {
          background: #1a1a2e !important;
          border: 1px solid #27273a !important;
        }
        /* Modal overlay */
        .shepherd-modal-overlay-container {
          fill: rgba(0, 0, 0, 1.0) !important;
        }
        /* Progress indicator in title */
        .shepherd-progress-text {
          color: #16a085 !important;
          font-size: 12px !important;
          font-weight: 400 !important;
          margin-left: 8px !important;
        }
        /* Skip button */
        .shepherd-button-skip {
          background: transparent !important;
          color: #71717a !important;
          border: none !important;
          padding: 8px 12px !important;
          margin-right: auto !important;
        }
        .shepherd-button-skip:hover {
          color: #a1a1aa !important;
          background: transparent !important;
        }
        /* Footer layout */
        .shepherd-element .shepherd-footer {
          display: flex !important;
          justify-content: space-between !important;
          align-items: center !important;
          gap: 8px !important;
        }
        .shepherd-footer-buttons {
          display: flex !important;
          gap: 8px !important;
        }
      `;
      document.head.appendChild(style);
    }

    mountedRef.current = true;

    // Create tour after delay
    const timeoutId = setTimeout(() => {
      if (!mountedRef.current) return;

      // Check if first element exists
      const firstElement = document.querySelector(TOUR_STEPS[0].element);
      if (!firstElement) return;

      const tour = new Shepherd.Tour({
        useModalOverlay: true,
        defaultStepOptions: {
          cancelIcon: { enabled: true },
          scrollTo: { behavior: 'smooth', block: 'center' },
          modalOverlayOpeningPadding: 8,
          modalOverlayOpeningRadius: 12,
        },
      });

      // Add all steps from config
      const total = TOUR_STEPS.length;
      TOUR_STEPS.forEach((step, i) => {
        const isFirst = i === 0;
        const isLast = i === total - 1;

        const buttons = [
          { text: 'Skip tour', action: tour.cancel, classes: 'shepherd-button-skip' },
          ...(!isFirst ? [{ text: '← Back', action: tour.back, classes: 'shepherd-button-secondary' }] : []),
          { text: isLast ? 'Done' : 'Next →', action: isLast ? tour.complete : tour.next, classes: 'shepherd-button-primary' },
        ];

        tour.addStep({
          id: step.id,
          title: `${step.title} <span class="shepherd-progress-text">(${i + 1}/${total})</span>`,
          text: step.text.replace('{{agentName}}', agentName),
          attachTo: { element: step.element, on: step.position },
          buttons,
        });
      });

      // Event handlers
      tour.on('complete', () => {
        markTourCompleted();
        setIsCompleted(true);
      });

      tour.on('cancel', () => {
        markTourCompleted();
        setIsCompleted(true);
      });

      tourRef.current = tour;
      tour.start();
    }, 1000);

    return () => {
      clearTimeout(timeoutId);
      if (tourRef.current) {
        tourRef.current.cancel();
        tourRef.current = null;
      }
      mountedRef.current = false;
    };
  }, [isTutorialMode, isCompleted, agentName]);

  return null;
}
