/**
 * Honest labelling. A photograph-like image of a reconstruction must not be mistakable for a record, so the saved
 * PNG carries this caption burned into its lower edge by default (and the on-screen mode shows the same words).
 */

export function captionText(site: string, year: string): string {
  return `${site} · ${year} · Reconstruction rendered from a 3D model, not a photograph or a record`;
}

export function drawCaption(ctx: CanvasRenderingContext2D, w: number, h: number, text: string): void {
  const fs = Math.max(11, Math.round(h * 0.017));
  const pad = Math.round(fs * 0.7);
  ctx.save();
  ctx.font = `600 ${fs}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.textBaseline = "middle";
  // shrink to fit narrow images
  let size = fs;
  while (ctx.measureText(text).width > w - pad * 4 && size > 8) {
    size -= 1;
    ctx.font = `600 ${size}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  }
  const tw = ctx.measureText(text).width;
  const bh = Math.round(size * 2);
  const x = pad, y = h - pad - bh;
  ctx.fillStyle = "rgba(12, 12, 10, 0.62)";
  ctx.fillRect(x, y, tw + pad * 2, bh);
  ctx.fillStyle = "rgba(255, 250, 238, 0.95)";
  ctx.fillText(text, x + pad, y + bh / 2 + 0.5);
  ctx.restore();
}
