'use client';

export function DemoButton() {
  return (
    <div style={{ padding: '0 8px 8px 8px', marginTop: '36px' }}>
      <a
        href="https://cal.com/vivek-aithal/minusx-bi"
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: 'block',
          textAlign: 'center',
          padding: '8px 16px',
          borderRadius: '6px',
          fontSize: '13px',
          fontWeight: 600,
          textDecoration: 'none',
          background: 'var(--color-fd-primary)',
          color: '#ffffff',
        }}
      >
        Book a Demo
      </a>
    </div>
  );
}
