import type { CSSProperties } from 'react';

export function AspectRatioSwatch({ ratio }: { ratio: string }) {
  const [width, height] = ratio.split(':').map(Number);
  const normalizedWidth = Number.isFinite(width) && width > 0 ? width : 1;
  const normalizedHeight = Number.isFinite(height) && height > 0 ? height : 1;
  const style = {
    '--aspect-ratio-value': normalizedWidth / normalizedHeight,
  } as CSSProperties;

  return (
    <span className="aspect-ratio-swatch" style={style} aria-hidden="true">
      <span className="aspect-ratio-swatch-shape" />
    </span>
  );
}
