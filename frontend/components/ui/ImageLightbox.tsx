'use client';

/**
 * Global in-page image lightbox. Any chat/screenshot image opens full-size HERE (driven by Redux
 * `lightboxImageUrl`) instead of a new tab. Backdrop click, the ✕, or Esc closes it. Mounted once
 * at the app root (app/layout.tsx).
 */
import { createPortal } from 'react-dom';
import { useEffect } from 'react';
import { Icon } from '@chakra-ui/react';
import { LuX } from 'react-icons/lu';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { selectLightboxImageUrl, closeImageLightbox } from '@/store/uiSlice';

export default function ImageLightbox() {
  const url = useAppSelector(selectLightboxImageUrl);
  const dispatch = useAppDispatch();

  useEffect(() => {
    if (!url) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') dispatch(closeImageLightbox()); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [url, dispatch]);

  if (!url || typeof document === 'undefined') return null;

  return createPortal(
    <div
      aria-label="Image preview"
      onClick={() => dispatch(closeImageLightbox())}
      style={{
        position: 'fixed', inset: 0, zIndex: 2147483647, background: 'rgba(0,0,0,0.85)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'zoom-out', padding: 24,
      }}
    >
      <button
        aria-label="Close image preview"
        onClick={(e) => { e.stopPropagation(); dispatch(closeImageLightbox()); }}
        style={{
          position: 'fixed', top: 16, right: 16, background: 'rgba(255,255,255,0.12)', color: '#fff',
          border: 'none', borderRadius: 8, width: 36, height: 36, display: 'flex',
          alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
        }}
      >
        <Icon as={LuX} boxSize={5} />
      </button>
      <img
        aria-label="Full size image"
        alt="Full size preview"
        src={url}
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '92vw', maxHeight: '92vh', objectFit: 'contain', borderRadius: 8, boxShadow: '0 8px 40px rgba(0,0,0,0.5)', cursor: 'default' }}
      />
    </div>,
    document.body,
  );
}
