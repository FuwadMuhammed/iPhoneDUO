import {
	ACESFilmicToneMapping,
	Group,
	MathUtils,
	PerspectiveCamera,
	PMREMGenerator,
	Raycaster,
	Scene,
	Spherical,
	Vector2,
	Vector3,
	WebGLRenderer,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

const CAMERA_DISTANCE = 40;
const HINGE_DEPTH = 0.275454;
const FRAMED_WIDTH = 17;
const FRAMED_HEIGHT = 16.5;
const FRAME_DAMPING = 9;
const MAX_BOTTOM_CARVE = 0.65;
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
interface Inset {
	left: number;
	bottom: number;
}
export function createStage(host: HTMLElement, obstacle: HTMLElement): Stage {
	const renderer = new WebGLRenderer({
		antialias: true,
		alpha: true,
		powerPreference: "high-performance",
	});
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
	renderer.domElement.style.cursor = "";
	const spherical = new Spherical();
	const scratch = new Vector3();
	const raycaster = new Raycaster();
	const pointer = new Vector2();
	const size = { width: 0, height: 0 };
	const target: Inset = { left: 0, bottom: 0 };
	const inset: Inset = { left: 0, bottom: 0 };
	let framed = false;
	let lastFrame = performance.now();
	function scaleFor(width: number, height: number, carve: Inset): number {
		return Math.min(
			(width - carve.left) / FRAMED_WIDTH,
			(height - carve.bottom) / FRAMED_HEIGHT,
		);
	}
	function project(): void {
		const { width, height } = size;
		const pixelsPerUnit = scaleFor(width, height, inset);
		camera.aspect = width / height;
		camera.fov = MathUtils.radToDeg(
			2 * Math.atan(height / pixelsPerUnit / 2 / CAMERA_DISTANCE),
		);
		camera.setViewOffset(
			width,
			height,
			-inset.left / 2,
			inset.bottom / 2,
			width,
			height,
		);
		camera.updateProjectionMatrix();
	}
	// The menu covers part of the stage: a rail down the left on wide screens, a dock along the bottom on
	// compact ones. Keep the device clear of it by carving whichever side leaves the device larger.
	function reframe(): void {
		const bounds = host.getBoundingClientRect();
		const { width, height } = bounds;
		if (width < 2 || height < 2) return;
		if (width !== size.width || height !== size.height) {
			size.width = width;
			size.height = height;
			renderer.setSize(width, height);
		}
		const rail = obstacle.getBoundingClientRect();
		const overlaps =
			rail.width > 0 &&
			rail.height > 0 &&
			rail.bottom > bounds.top &&
			rail.top < bounds.bottom &&
			rail.right > bounds.left &&
			rail.left < bounds.right;
		const fromLeft: Inset = {
			left: overlaps
				? MathUtils.clamp(rail.right - bounds.left, 0, width / 2)
				: 0,
			bottom: 0,
		};
		const fromBottom: Inset = {
			left: 0,
			bottom: overlaps
				? MathUtils.clamp(
						bounds.bottom - rail.top,
						0,
						height * MAX_BOTTOM_CARVE,
					)
				: 0,
		};
		const best =
			scaleFor(width, height, fromLeft) >= scaleFor(width, height, fromBottom)
				? fromLeft
				: fromBottom;
		target.left = best.left;
		target.bottom = best.bottom;
		if (!framed) {
			framed = true;
			inset.left = target.left;
			inset.bottom = target.bottom;
		}
		project();
	}
	function ease(): void {
		const now = performance.now();
		const step = Math.min((now - lastFrame) / 1000, 0.1);
		lastFrame = now;
		if (
			Math.abs(target.left - inset.left) < 0.25 &&
			Math.abs(target.bottom - inset.bottom) < 0.25
		) {
			if (inset.left === target.left && inset.bottom === target.bottom) return;
			inset.left = target.left;
			inset.bottom = target.bottom;
		} else {
			inset.left = MathUtils.damp(inset.left, target.left, FRAME_DAMPING, step);
			inset.bottom = MathUtils.damp(
				inset.bottom,
				target.bottom,
				FRAME_DAMPING,
				step,
			);
		}
		project();
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
			ease();
			controls.update();
			renderer.render(scene, camera);
		},
		readView() {
			spherical.setFromVector3(
				scratch.copy(camera.position).sub(controls.target),
			);
			return {
				distance: spherical.radius,
				pitch: spherical.phi,
				yaw: spherical.theta,
			};
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
