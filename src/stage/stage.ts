import {
  ACESFilmicToneMapping,
  Group,
  MathUtils,
  PMREMGenerator,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Spherical,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
const CAMERA_DISTANCE = 40;
const HINGE_DEPTH = 0.275454;
const FRAMED_WIDTH = 17;
const FRAMED_HEIGHT = 14.5;
export interface StageView {
  readonly distance: number;
  readonly pitch: number;
  readonly yaw: number;
}
export type PoseAngles = readonly [number, number, number];
export type Offset = readonly [number, number];
export interface Stage {
  readonly scene: Scene;
  readonly renderer: WebGLRenderer;
  readonly camera: PerspectiveCamera;
  readonly content: Group;
  render(): void;
  readView(): StageView;
  applyView(view: StageView): void;
  readPose(): PoseAngles;
  setPose(pose: PoseAngles): void;
  readOffset(): Offset;
  setOffset(offset: Offset): void;
  setOrbitEnabled(enabled: boolean): void;
  orbitEnabled(): boolean;
  eyeInContent(): Vector3;
  hitsContent(clientX: number, clientY: number): boolean;
}
export function createStage(host: HTMLElement, obstacle: HTMLElement): Stage {
  const renderer = new WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0xffffff, 0);
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  host.appendChild(renderer.domElement);
  const scene = new Scene();
  const environment = new RoomEnvironment();
  const pmrem = new PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(environment, 0.04).texture;
  scene.environmentIntensity = 0.85;
  environment.dispose();
  pmrem.dispose();
  const content = new Group();
  scene.add(content);
  const camera = new PerspectiveCamera(32, 1, 0.1, 250);
  camera.position.set(0, 0, CAMERA_DISTANCE);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.enableZoom = false;
  controls.target.set(0, 0, HINGE_DEPTH);
  controls.update();
  const spherical = new Spherical();
  const scratch = new Vector3();
  const raycaster = new Raycaster();
  const pointer = new Vector2();
  function reframe(): void {
    const bounds = host.getBoundingClientRect();
    const { width, height } = bounds;
    if (width < 2 || height < 2) return;
    const rail = obstacle.getBoundingClientRect();
    const overlaps =
      rail.bottom > bounds.top && rail.top < bounds.bottom && rail.right > bounds.left && rail.left < bounds.right;
    const inset = overlaps ? MathUtils.clamp(rail.right - bounds.left, 0, width / 2) : 0;
    renderer.setSize(width, height);
    camera.aspect = width / height;
    const pixelsPerUnit = Math.min((width - inset) / FRAMED_WIDTH, height / FRAMED_HEIGHT);
    camera.fov = MathUtils.radToDeg(2 * Math.atan(height / pixelsPerUnit / 2 / CAMERA_DISTANCE));
    camera.setViewOffset(width, height, -inset / 2, 0, width, height);
    camera.updateProjectionMatrix();
  }
  const observer = new ResizeObserver(reframe);
  observer.observe(host);
  observer.observe(obstacle);
  reframe();
  return {
    scene,
    renderer,
    camera,
    content,
    render() {
      controls.update();
      renderer.render(scene, camera);
    },
    readView() {
      spherical.setFromVector3(scratch.copy(camera.position).sub(controls.target));
      return { distance: spherical.radius, pitch: spherical.phi, yaw: spherical.theta };
    },
    applyView(view) {
      spherical.set(view.distance, view.pitch, view.yaw).makeSafe();
      camera.position.setFromSpherical(spherical).add(controls.target);
      camera.lookAt(controls.target);
    },
    readPose() {
      return [content.rotation.x, content.rotation.y, content.rotation.z];
    },
    setPose(pose) {
      content.rotation.set(pose[0], pose[1], pose[2]);
    },
    readOffset() {
      return [content.position.x, content.position.y];
    },
    setOffset(offset) {
      content.position.x = offset[0];
      content.position.y = offset[1];
    },
    setOrbitEnabled(enabled) {
      controls.enabled = enabled;
    },
    orbitEnabled() {
      return controls.enabled;
    },
    eyeInContent() {
      return content.worldToLocal(scratch.copy(camera.position)).clone();
    },
    hitsContent(clientX, clientY) {
      const bounds = renderer.domElement.getBoundingClientRect();
      pointer.set(
        ((clientX - bounds.left) / bounds.width) * 2 - 1,
        -((clientY - bounds.top) / bounds.height) * 2 + 1,
      );
      raycaster.setFromCamera(pointer, camera);
      return raycaster.intersectObject(content, true).length > 0;
    },
  };
}
