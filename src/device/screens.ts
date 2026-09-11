const INNER_WIDTH = 1600;
const OUTER_WIDTH = 774;
const HEIGHT = 1125;
const UI_ASSETS = `${import.meta.env.BASE_URL}assets/ui/`;

const CLOCK_TIME_BOX = { width: 0.73, height: 0.54 };
const OUTER_WALLPAPER_BIAS = -0.1;

export type ScreenImage = HTMLImageElement | HTMLCanvasElement;
export type RollDirection = 'clockwise' | 'anticlockwise';
export type ScreenPanel = 'inner' | 'outer';

export interface ClockPlates {
  readonly time: ScreenImage;
  readonly chrome: ScreenImage;
}

export interface LockScreen {
  readonly backdrop: ScreenImage;
  readonly sky: ScreenImage;
  readonly mountain: ScreenImage;
  readonly innerClock: ClockPlates;
  readonly outerClock: ClockPlates;
}

async function loadImage(src: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.src = src;
  await image.decode();
  return image;
}

function canvasContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('A 2D canvas context is not available.');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  return context;
}

function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function keepBox(plate: HTMLImageElement, box: { width: number; height: number }, inside: boolean): HTMLCanvasElement {
  const canvas = createCanvas(plate.naturalWidth, plate.naturalHeight);
  const context = canvasContext(canvas);
  context.drawImage(plate, 0, 0);
  if (inside) {
    context.clearRect(box.width, 0, canvas.width - box.width, canvas.height);
    context.clearRect(0, box.height, box.width, canvas.height - box.height);
  } else {
    context.clearRect(0, 0, box.width, box.height);
  }
  return canvas;
}

function splitClock(plate: HTMLImageElement): ClockPlates {
  const box = {
    width: Math.round(plate.naturalWidth * CLOCK_TIME_BOX.width),
    height: Math.round(plate.naturalHeight * CLOCK_TIME_BOX.height),
  };
  return { time: keepBox(plate, box, true), chrome: keepBox(plate, box, false) };
}

export async function loadLockScreen(): Promise<LockScreen> {
  const [backdrop, sky, mountain, innerClock, outerClock] = await Promise.all([
    loadImage(`${UI_ASSETS}base.jpg`),
    loadImage(`${UI_ASSETS}top.png`),
    loadImage(`${UI_ASSETS}middle.png`),
    loadImage(`${UI_ASSETS}clock-inner.avif`),
    loadImage(`${UI_ASSETS}clock-outer.avif`),
  ]);
  return { backdrop, sky, mountain, innerClock: splitClock(innerClock), outerClock: splitClock(outerClock) };
}

function drawCover(
  context: CanvasRenderingContext2D,
  image: ScreenImage,
  width: number,
  height: number,
  bias = 0,
): void {
  const source = image instanceof HTMLCanvasElement ? { width: image.width, height: image.height } : image;
  const scale = Math.max(width / source.width, height / source.height);
  const drawn = { width: source.width * scale, height: source.height * scale };
  const left = Math.min(0, Math.max(width - drawn.width, (width - drawn.width) / 2 + bias * width));
  context.drawImage(image, left, (height - drawn.height) / 2, drawn.width, drawn.height);
}

export type ScreenTurn = 'none' | RollDirection;

export function paintPanelLockScreen(
  lockScreen: LockScreen,
  panel: ScreenPanel,
  turn: ScreenTurn,
): HTMLCanvasElement {
  const width = panel === 'inner' ? INNER_WIDTH : OUTER_WIDTH;
  const upright = turn === 'none';
  const clock =
    (panel === 'inner') === upright ? lockScreen.innerClock : lockScreen.outerClock;
  const canvas = createCanvas(width, HEIGHT);
  const context = canvasContext(canvas);
  if (turn === 'clockwise') {
    context.translate(width, 0);
    context.rotate(Math.PI / 2);
  } else if (turn === 'anticlockwise') {
    context.translate(0, HEIGHT);
    context.rotate(-Math.PI / 2);
  }
  const frame = upright ? { width, height: HEIGHT } : { width: HEIGHT, height: width };
  const bias = panel === 'outer' ? OUTER_WALLPAPER_BIAS : 0;
  const foreground = createCanvas(frame.width, frame.height);
  const front = canvasContext(foreground);
  drawCover(front, lockScreen.backdrop, frame.width, frame.height, bias);
  front.globalCompositeOperation = 'destination-out';
  drawCover(front, lockScreen.sky, frame.width, frame.height, bias);
  drawCover(context, lockScreen.backdrop, frame.width, frame.height, bias);
  context.drawImage(clock.time, 0, 0, frame.width, frame.height);
  context.drawImage(foreground, 0, 0);
  context.drawImage(clock.chrome, 0, 0, frame.width, frame.height);
  return canvas;
}

export function paintFittedImage(image: ScreenImage): HTMLCanvasElement {
  const canvas = createCanvas(INNER_WIDTH, HEIGHT);
  const context = canvasContext(canvas);
  context.fillStyle = '#101418';
  context.fillRect(0, 0, canvas.width, canvas.height);
  const source = image instanceof HTMLCanvasElement ? { width: image.width, height: image.height } : image;
  const scale = Math.min(canvas.width / source.width, canvas.height / source.height);
  const width = source.width * scale;
  const height = source.height * scale;
  context.drawImage(image, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
  return canvas;
}

export async function paintCustomImage(file: File): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(file);
  try {
    return paintFittedImage(await loadImage(url));
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function loadStaticImage(src: string): Promise<HTMLCanvasElement> {
  return paintFittedImage(await loadImage(src));
}
