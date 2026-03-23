import Image from 'next/image';

interface ThemedImageProps {
  light: string;
  dark: string;
  alt: string;
  width?: number;
  height?: number;
}

export function ThemedImage({ light, dark, alt, width, height }: ThemedImageProps) {
  return (
    <>
      <Image
        src={light}
        alt={alt}
        width={width ?? 1200}
        height={height ?? 675}
        className="themed-img-light"
        style={{ borderRadius: '8px', border: '1px solid var(--color-fd-border)' }}
      />
      <Image
        src={dark}
        alt={alt}
        width={width ?? 1200}
        height={height ?? 675}
        className="themed-img-dark"
        style={{ borderRadius: '8px', border: '1px solid var(--color-fd-border)' }}
      />
    </>
  );
}
