// Captures the existing WebGL canvas from the outside, via the standard captureStream API, so the
// fold rig itself never needs preserveDrawingBuffer or any other change to how it renders. Every export
// (still or video) is redrawn through one small 2D composite canvas so the chosen background - a solid
// colour or, for PNG only, transparency - applies consistently regardless of what the source alpha does
// once it has gone through a <video> element or a video codec.
const WEBM_CANDIDATES = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
const MP4_CANDIDATES = ['video/mp4;codecs=avc1', 'video/mp4'];
const JPEG_QUALITY = 0.92;

export type VideoFormat = 'webm' | 'mp4';
export type ImageFormat = 'png' | 'jpeg';
export type Background = { readonly transparent: true } | { readonly transparent: false; readonly color: string };

export function videoFormatSupported(format: VideoFormat): boolean {
  return pickVideoMimeType(format) !== '';
}

function pickVideoMimeType(format: VideoFormat): string {
  const candidates = format === 'mp4' ? MP4_CANDIDATES : WEBM_CANDIDATES;
  for (const type of candidates) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return '';
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function waitForFrames(video: HTMLVideoElement, count: number): Promise<void> {
  type FrameVideo = HTMLVideoElement & {
    requestVideoFrameCallback?(callback: () => void): number;
  };
  const withCallback = video as FrameVideo;
  if (!withCallback.requestVideoFrameCallback) return new Promise((resolve) => setTimeout(resolve, 150));
  return new Promise((resolve) => {
    let seen = 0;
    const onFrame = (): void => {
      seen += 1;
      if (seen >= count) resolve();
      else withCallback.requestVideoFrameCallback?.(onFrame);
    };
    withCallback.requestVideoFrameCallback(onFrame);
  });
}

interface Bounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

// The stage renders the device onto a canvas much larger than the phone itself (it shares the frame with
// empty margin and the highlight rail). The renderer clears to alpha 0 and the device is fully opaque, so
// scanning for non-transparent pixels finds exactly the phone's silhouette - no stage/camera code needed.
const ALPHA_THRESHOLD = 10;
// The light-grey margin the .viewer shows around the phone on screen (see --stage-backdrop in
// styles.css) - kept in device pixels here so the export frames the phone exactly as it looks live.
const BORDER_CSS_PX = 50;

// `frameWidth` is the pixel width of whichever frame is being cropped (the live canvas, or a higher-res
// still of it); `canvas` supplies the on-screen CSS width the border is defined against.
function borderPixels(canvas: HTMLCanvasElement, frameWidth = canvas.width): number {
  const scale = canvas.clientWidth > 0 ? frameWidth / canvas.clientWidth : 1;
  return Math.round(BORDER_CSS_PX * scale);
}

function detectContentBounds(source: CanvasImageSource, width: number, height: number, padding: number): Bounds {
  const full: Bounds = { x: 0, y: 0, width, height };
  const probe = document.createElement('canvas');
  probe.width = width;
  probe.height = height;
  const context = probe.getContext('2d');
  if (!context) return full;
  context.clearRect(0, 0, width, height);
  context.drawImage(source, 0, 0, width, height);
  const { data } = context.getImageData(0, 0, width, height);
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    for (let x = 0; x < width; x++) {
      if (data[row + x * 4 + 3] <= ALPHA_THRESHOLD) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return full;
  const x = Math.max(0, minX - padding);
  const y = Math.max(0, minY - padding);
  return {
    x,
    y,
    width: Math.min(width, maxX + padding + 1) - x,
    height: Math.min(height, maxY + padding + 1) - y,
  };
}

function unionBounds(a: Bounds, b: Bounds): Bounds {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

function paintFrame(
  context: CanvasRenderingContext2D,
  source: CanvasImageSource,
  bounds: Bounds,
  background: Background,
  outWidth = bounds.width,
  outHeight = bounds.height,
): void {
  context.clearRect(0, 0, outWidth, outHeight);
  if (!background.transparent) {
    context.fillStyle = background.color;
    context.fillRect(0, 0, outWidth, outHeight);
  }
  context.drawImage(source, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0, outWidth, outHeight);
}

// Mirrors the source canvas into a hidden <video> via captureStream, purely so callers can read a live
// frame back out (with drawImage) without touching the WebGL renderer's own preserveDrawingBuffer setting.
class FrameMirror {
  private readonly stream: MediaStream;
  readonly video: HTMLVideoElement;

  constructor(canvas: HTMLCanvasElement, fps: number) {
    this.stream = canvas.captureStream(fps);
    this.video = document.createElement('video');
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.style.cssText = 'position:fixed;left:-9999px;top:0;width:2px;height:2px;opacity:0;';
    this.video.srcObject = this.stream;
    document.body.appendChild(this.video);
  }

  async ready(): Promise<void> {
    await this.video.play();
    await waitForFrames(this.video, 2);
  }

  dispose(): void {
    this.stream.getTracks().forEach((track) => track.stop());
    this.video.remove();
  }
}

// Crops a rendered frame of the stage (see MockupBridge.renderStill) to the phone plus its on-screen
// margin and composites the chosen background - exactly what an image export contains.
export function composeStill(frame: HTMLCanvasElement, canvas: HTMLCanvasElement, background: Background): HTMLCanvasElement {
  const bounds = detectContentBounds(frame, frame.width, frame.height, borderPixels(canvas, frame.width));
  const out = document.createElement('canvas');
  out.width = bounds.width;
  out.height = bounds.height;
  const context = out.getContext('2d');
  if (!context) throw new Error('A 2D canvas context is not available.');
  paintFrame(context, frame, bounds, background);
  return out;
}

export async function exportStill(still: HTMLCanvasElement, format: ImageFormat, slug = 'mockup'): Promise<void> {
  const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png';
  const blob = await new Promise<Blob | null>((resolve) => still.toBlob(resolve, mime, JPEG_QUALITY));
  if (!blob) throw new Error('Could not encode the snapshot.');
  download(blob, `iphone-duo-${slug}-${Date.now()}.${format === 'jpeg' ? 'jpg' : 'png'}`);
}

export interface RecordOptions {
  readonly fps: number;
  // A frame of the pose fully open (its widest state), from MockupBridge.maxOpennessFrame(). The
  // recording's crop is sized to fit both this and the opening frame, so opening the fold slider mid-
  // recording doesn't get cut off by a crop sized to whatever openness happened to be showing at the
  // start (see the comment above where bounds is used, below).
  readonly widestFrame?: HTMLCanvasElement | null;
}

export class MockupRecorder {
  private mirror: FrameMirror | null = null;
  private compositeStream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private rafId: number | null = null;
  private extension = 'webm';

  get active(): boolean {
    return this.recorder !== null;
  }

  async start(canvas: HTMLCanvasElement, format: VideoFormat, background: Background, options: RecordOptions): Promise<void> {
    if (this.recorder) return;
    const { fps } = options;
    const mimeType = pickVideoMimeType(format);
    if (!mimeType) throw new Error(`This browser cannot record ${format.toUpperCase()} video.`);
    const mirror = new FrameMirror(canvas, fps);
    await mirror.ready();
    const fullWidth = mirror.video.videoWidth || canvas.width;
    const fullHeight = mirror.video.videoHeight || canvas.height;
    // Cropped once from the opening frame (widened to also fit the fully-open fold state, if this pose
    // has a slider - see widestFrame above); re-detecting every frame would zoom/pan the recording as
    // the device's silhouette changes size while it folds or rotates.
    let bounds = detectContentBounds(mirror.video, fullWidth, fullHeight, borderPixels(canvas));
    if (options.widestFrame) {
      const wide = options.widestFrame;
      const wideBounds = detectContentBounds(wide, wide.width, wide.height, borderPixels(canvas, wide.width));
      bounds = unionBounds(bounds, wideBounds);
    }
    // Even dimensions: H.264 in particular rejects odd sizes.
    const outWidth = Math.max(2, Math.round(bounds.width / 2) * 2);
    const outHeight = Math.max(2, Math.round(bounds.height / 2) * 2);
    const composite = document.createElement('canvas');
    composite.width = outWidth;
    composite.height = outHeight;
    const context = composite.getContext('2d');
    if (!context) {
      mirror.dispose();
      throw new Error('A 2D canvas context is not available.');
    }
    // Video containers do not carry alpha reliably across browsers, so recordings always use a solid fill.
    const solid: Background = background.transparent ? { transparent: false, color: '#ffffff' } : background;
    const draw = (): void => {
      paintFrame(context, mirror.video, bounds, solid, outWidth, outHeight);
      this.rafId = requestAnimationFrame(draw);
    };
    draw();
    this.mirror = mirror;
    this.extension = format;
    this.compositeStream = composite.captureStream(fps);
    this.chunks = [];
    this.recorder = new MediaRecorder(this.compositeStream, { mimeType, videoBitsPerSecond: 12_000_000 });
    this.recorder.ondataavailable = (event) => {
      if (event.data.size > 0) this.chunks.push(event.data);
    };
    this.recorder.start();
  }

  stop(): Promise<void> {
    const recorder = this.recorder;
    if (!recorder) return Promise.resolve();
    return new Promise((resolve) => {
      recorder.onstop = () => {
        const blob = new Blob(this.chunks, { type: recorder.mimeType });
        download(blob, `iphone-duo-mockup-${Date.now()}.${this.extension}`);
        this.cleanup();
        resolve();
      };
      recorder.stop();
    });
  }

  private cleanup(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this.compositeStream?.getTracks().forEach((track) => track.stop());
    this.compositeStream = null;
    this.mirror?.dispose();
    this.mirror = null;
    this.recorder = null;
    this.chunks = [];
  }
}
