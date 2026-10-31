import React from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';

/** Renders a React element that returns an <svg> and gives back the SVG markup. */
export function svgMarkup(element: React.ReactElement): { markup: string; width: number; height: number } {
  const host = document.createElement('div');
  host.style.position = 'fixed';
  host.style.left = '-10000px';
  host.style.top = '0';
  host.style.width = '1200px';
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    flushSync(() => root.render(element));
    const svg = host.querySelector('svg');
    if (!svg) return { markup: '', width: 0, height: 0 };
    const vb = (svg.getAttribute('viewBox') ?? '0 0 100 100').split(/\s+/).map(Number);
    return { markup: new XMLSerializer().serializeToString(svg), width: vb[2], height: vb[3] };
  } finally {
    root.unmount();
    host.remove();
  }
}

/** Rasterises SVG markup to a PNG data URL of the given pixel width. */
export async function svgToPng(markup: string, aspect: number, widthPx: number): Promise<string> {
  const blob = new Blob([markup], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Could not draw the figure.'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = widthPx;
    canvas.height = Math.round(widthPx * aspect);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas is not available.');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(url);
  }
}
