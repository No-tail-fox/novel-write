import { measureNativeCanvasText, type NativeCanvasText } from './native-canvas-text';

/** Carry cached glyph evidence only when that cache is actually painted in this frame. */
export function projectCachedCanvasText(context: CanvasRenderingContext2D, source: {width:number;height:number}, args: number[], row: NativeCanvasText): NativeCanvasText | undefined {
  const [sx, sy, sw, sh, dx, dy, dw, dh] = args.length === 8 ? args : [0, 0, source.width, source.height, args[0], args[1], args[2] ?? source.width, args[3] ?? source.height];
  if (context.globalAlpha <= .05 || ![sx,sy,sw,sh,dx,dy,dw,dh].every(Number.isFinite) || sw <= 0 || sh <= 0 || dw <= 0 || dh <= 0) return;
  // Keep visible fragments as diagnostic evidence. Dropping them hid clipped titles.
  const left = Math.max(0, sx), top = Math.max(0, sy);
  const right = Math.min(source.width, sx + sw), bottom = Math.min(source.height, sy + sh);
  if (row.x1 <= left || row.y1 <= top || row.x0 >= right || row.y0 >= bottom) return;
  const clipped = row.clipped || row.x0 < left - 1 || row.y0 < top - 1 || row.x1 > right + 1 || row.y1 > bottom + 1;
  const m = context.getTransform();
  const points = [[row.x0,row.y0],[row.x1,row.y0],[row.x0,row.y1],[row.x1,row.y1]].map(([x,y]) => {
    const px = dx + (x-sx)*dw/sw, py = dy + (y-sy)*dh/sh;
    return {x:m.a*px+m.c*py+m.e,y:m.b*px+m.d*py+m.f};
  });
  const projected = {...row,...(clipped ? {clipped:true} : {}),x0:Math.min(...points.map(p=>p.x)),y0:Math.min(...points.map(p=>p.y)),x1:Math.max(...points.map(p=>p.x)),y1:Math.max(...points.map(p=>p.y)),fontSize:row.fontSize*dh/sh*Math.hypot(m.c,m.d)};
  if (projected.x1 <= 0 || projected.y1 <= 0 || projected.x0 >= context.canvas.width || projected.y0 >= context.canvas.height) return;
  return projected;
}

export function installNativeCanvasTextTracker(prototype: CanvasRenderingContext2D, onFont: (row: {text:string;font:string}) => void) {
  const caches = new WeakMap<object, NativeCanvasText[]>();
  const frame = new Map<object, NativeCanvasText[]>();
  const dimensions = new WeakMap<object, string>();
  const record = (context: CanvasRenderingContext2D, row: NativeCanvasText) => {
    const canvas = context.canvas, size = canvas.width + ':' + canvas.height;
    if (dimensions.get(canvas) !== size) { caches.delete(canvas); dimensions.set(canvas,size); }
    const rows = caches.get(canvas) ?? [];
    if (rows.length < 2048) { rows.push(row); caches.set(canvas,rows); }
    if ((canvas as HTMLCanvasElement).isConnected) {
      const current = frame.get(canvas) ?? [];
      if (current.length < 2048) { current.push(row); frame.set(canvas,current); }
    }
  };
  for (const key of ['fillText','strokeText'] as const) {
    const original = prototype[key];
    prototype[key] = function(text: string, x: number, y: number, maxWidth?: number) {
      const result = maxWidth === undefined ? original.call(this,text,x,y) : original.call(this,text,x,y,maxWidth);
      onFont({text:String(text),font:this.font});
      const measured = measureNativeCanvasText(this,String(text),x,y,maxWidth,true);
      if (measured) record(this,measured);
      return result;
    };
  }
  const drawImage = prototype.drawImage;
  prototype.drawImage = function(image: CanvasImageSource, ...args: number[]) {
    const result = (drawImage as (...args: unknown[]) => void).apply(this,[image,...args]);
    const source = image as HTMLCanvasElement;
    if (dimensions.get(source) === source.width + ':' + source.height) for (const row of [...caches.get(source) ?? []]) {
      const projected = projectCachedCanvasText(this,source,args,row);
      if (projected) record(this,projected);
    }
    return result;
  };
  const fillRect = prototype.fillRect;
  prototype.fillRect = function(x:number,y:number,width:number,height:number) {
    const result = fillRect.call(this,x,y,width,height);
    const m = this.getTransform();
    if (this.globalCompositeOperation === 'source-in' && m.a === 1 && m.b === 0 && m.c === 0 && m.d === 1
      && x + m.e <= 0 && y + m.f <= 0 && x + m.e + width >= this.canvas.width && y + m.f + height >= this.canvas.height) {
      // Tinting a solid paper panel erases its lettering; tinting a transparent
      // glyph preserves the glyph. Check alpha so recolored text is not hidden.
      const rows = caches.get(this.canvas) ?? [];
      if (rows.length) {
        try {
          const image = this.getImageData(0, 0, this.canvas.width, this.canvas.height);
          const visible = rows.filter(row => {
            const left = Math.max(0, Math.floor(row.x0)), top = Math.max(0, Math.floor(row.y0));
            const right = Math.min(image.width, Math.ceil(row.x1)), bottom = Math.min(image.height, Math.ceil(row.y1));
            const alpha = image.data[(top * image.width + left) * 4 + 3];
            for (let py = top; py < bottom; py++) for (let px = left; px < right; px++) {
              if (image.data[(py * image.width + px) * 4 + 3] !== alpha) return true;
            }
            return false;
          });
          caches.set(this.canvas, visible);
          if (frame.has(this.canvas)) frame.set(this.canvas, visible);
        } catch { /* Keep evidence when pixel readback is unavailable. */ }
      }
    }
    return result;
  };
  const clearRect = prototype.clearRect;
  prototype.clearRect = function(x:number,y:number,width:number,height:number) {
    const result = clearRect.call(this,x,y,width,height);
    // Never keep historical text as evidence after its backing canvas is cleared.
    if (width && height) { caches.delete(this.canvas); frame.delete(this.canvas); }
    return result;
  };
  return { beginFrame() { frame.clear(); }, frameTexts() { return [...frame.values()].flat().slice(0,2048); } };
}

