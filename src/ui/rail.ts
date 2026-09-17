import { HIGHLIGHTS, type Highlight } from "../device/highlights";

const MORPH_MS = 720;
const MORPH_EASING = "cubic-bezier(0.32, 0.72, 0, 1)";
const NUDGE = 0.5;
const SLIDER_STEPS = 1000;
const PLUS_MARK = '<path d="M12 6.6v10.8M6.6 12h10.8" />';
const COMPACT_QUERY =
	"(max-width: 900px), (max-height: 540px) and (orientation: landscape)";
export interface Rail {
	readonly slider: HTMLInputElement;
	readonly current: Highlight;
	readonly isOpen: boolean;
	select(highlight: Highlight): void;
	collapse(): void;
	unlock(): void;
	markUploaded(id: string, hasImage: boolean): void;
}
function mark(paths: string): SVGSVGElement {
	const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	svg.setAttribute("viewBox", "0 0 24 24");
	svg.setAttribute("aria-hidden", "true");
	svg.innerHTML = paths;
	return svg;
}
function foldControl(): HTMLInputElement {
	const slider = document.createElement("input");
	slider.id = "fold";
	slider.className = "fold-slider";
	slider.type = "range";
	slider.min = "0";
	slider.max = String(SLIDER_STEPS);
	slider.step = "1";
	slider.disabled = true;
	slider.setAttribute("aria-label", "Fold amount");
	return slider;
}
function buildItem(highlight: Highlight): {
	item: HTMLLIElement;
	box: HTMLElement;
	chip: HTMLButtonElement;
	detail: HTMLElement;
} {
	const item = document.createElement("li");
	item.className = "highlight";
	item.id = `highlight-${highlight.id}`;
	const box = document.createElement("div");
	box.className = "highlight-box";
	const chip = document.createElement("button");
	chip.type = "button";
	chip.className = "highlight-chip";
	chip.setAttribute("aria-expanded", "false");
	// Every pose starts as a "+" (add an image); the badge turns accent-filled once one is uploaded.
	const badge = document.createElement("span");
	badge.className = "highlight-mark";
	badge.append(mark(PLUS_MARK));
	const name = document.createElement("span");
	name.textContent = highlight.label;
	chip.append(badge, name);
	const detail = document.createElement("div");
	detail.className = "highlight-detail";
	// The chip (and its label) fades out while a card is open, so the card names itself.
	const heading = document.createElement("span");
	heading.className = "highlight-heading";
	heading.textContent = highlight.label;
	detail.append(heading);
	box.append(chip, detail);
	item.append(box);
	return { item, box, chip, detail };
}
export function createRail(list: HTMLElement, sheet: HTMLElement, onSelect: (highlight: Highlight) => void): Rail {
	const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
	const compact = window.matchMedia(COMPACT_QUERY);
	// On compact screens the list becomes a dropdown pinned to the viewer's top-left, so it moves out of
	// the rack (which then only spans the bottom sheet and keeps the stage's obstacle box honest).
	const rack = list.parentElement!;
	const viewer = rack.parentElement!;
	const slider = foldControl();
	const boxes: HTMLElement[] = [];
	const items: HTMLLIElement[] = [];
	const details: HTMLElement[] = [];
	let current = HIGHLIGHTS[0]!;
	let openId: string | null = current.id;
	let locked = true;
	let menuOpen = false;
	HIGHLIGHTS.forEach((highlight) => {
		const { item, box, chip, detail } = buildItem(highlight);
		if (highlight.adjustable) {
			const control = document.createElement("label");
			control.className = "fold-control";
			const hint = document.createElement("span");
			hint.className = "fold-label";
			hint.textContent = "Drag below to open and close";
			control.append(hint, slider);
			detail.append(control);
		}
		// Filled by the mockup module once the 3D chunk is up (see uploads.ts). Keyed by attribute
		// rather than by item id because paint() re-parents the detail into the sheet on mobile.
		const slot = document.createElement("div");
		slot.className = "highlight-slot";
		slot.dataset.uploadSlot = highlight.id;
		detail.append(slot);
		chip.addEventListener("click", () => {
				// In compact mode the current chip is a dropdown trigger, not a re-select: tapping it
				// just opens/closes the list of other poses instead of re-running the settle animation.
				if (compact.matches) {
					if (highlight.id === current.id) {
						menuOpen = !menuOpen;
						paint();
						return;
					}
					menuOpen = false;
				}
				select(highlight);
			});
		list.append(item);
		boxes.push(box);
		items.push(item);
		details.push(detail);
	});
	function morph(change: () => void): void {
		if (reduced) {
			change();
			return;
		}
		const targets = compact.matches ? [sheet] : boxes;
		const before = targets.map((box) => box.getBoundingClientRect());
		const shown = sheet.firstElementChild;
		targets.forEach((box) => box.getAnimations().forEach((animation) => animation.cancel()));
		change();
		targets.forEach((box, index) => {
			const from = before[index]!;
			const to = box.getBoundingClientRect();
			const shift = compact.matches ? 0 : from.top - to.top;
			const still =
				Math.abs(from.width - to.width) < NUDGE &&
				Math.abs(from.height - to.height) < NUDGE &&
				Math.abs(shift) < NUDGE;
			if (still) return;
			box.animate(
				[
					{
						width: `${from.width}px`,
						height: `${from.height}px`,
						transform: `translateY(${shift}px)`,
					},
					{
						width: `${to.width}px`,
						height: `${to.height}px`,
						transform: "translateY(0)",
					},
				],
				{ duration: MORPH_MS, easing: MORPH_EASING },
			);
		});
		const incoming = sheet.firstElementChild;
		if (compact.matches && incoming && incoming !== shown) {
			incoming.animate([{ opacity: 0 }, { opacity: 1 }], {
				duration: 320,
				delay: 120,
				easing: "ease",
				fill: "backwards",
			});
		}
	}
	function reveal(index: number, smooth: boolean): void {
		const item = items[index];
		if (!item) return;
		const behavior = smooth && !reduced ? "smooth" : "auto";
		if (compact.matches) {
			list.scrollTo({
				left: item.offsetLeft - (list.clientWidth - item.offsetWidth) / 2,
				behavior,
			});
		} else {
			const growing = boxes.flatMap((box) => box.getAnimations());
			void Promise.allSettled(growing.map((animation) => animation.finished)).then(() => {
				if (compact.matches || list.scrollHeight <= list.clientHeight) return;
				const box = item.getBoundingClientRect();
				const view = list.getBoundingClientRect();
				const top = box.top - view.top - NUDGE * 8;
				const bottom = box.bottom - view.bottom + NUDGE * 8;
				const delta = top < 0 ? top : bottom > 0 ? Math.min(bottom, top) : 0;
				if (delta !== 0) list.scrollBy({ top: delta, behavior });
			});
		}
	}
	function paint(): void {
		const index = HIGHLIGHTS.indexOf(current);
		list.classList.toggle("is-menu-open", compact.matches && menuOpen);
		items.forEach((item, at) => {
			const open = HIGHLIGHTS[at]!.id === openId;
			item.classList.toggle("is-open", open);
			item.classList.toggle("is-current", at === index);
			item
				.querySelector(".highlight-chip")
				?.setAttribute("aria-expanded", String(open));
		});
		if (compact.matches) {
			if (list.parentElement !== viewer) viewer.append(list);
			const open = details[index];
			if (open && sheet.firstElementChild !== open) sheet.replaceChildren(open);
			sheet.classList.toggle("is-collapsed", openId === null);
		} else {
			if (list.parentElement !== rack) rack.append(list);
			details.forEach((detail, at) => {
				if (detail.parentElement !== boxes[at]) boxes[at]!.append(detail);
			});
			sheet.classList.add("is-collapsed");
		}
		slider.disabled = locked || !current.adjustable || openId !== current.id;
	}
	function select(highlight: Highlight): void {
		current = highlight;
		openId = highlight.id;
		morph(paint);
		reveal(HIGHLIGHTS.indexOf(highlight), true);
		onSelect(highlight);
	}
	function collapse(): void {
		menuOpen = false;
		if (openId === null) return;
		openId = null;
		morph(paint);
	}
	compact.addEventListener("change", () => {
		menuOpen = false;
		paint();
		reveal(HIGHLIGHTS.indexOf(current), false);
	});
	document.addEventListener("click", (event) => {
		if (!compact.matches || !menuOpen) return;
		if (list.contains(event.target as Node)) return;
		menuOpen = false;
		paint();
	});
	paint();
	return {
		slider,
		get current() {
			return current;
		},
		get isOpen() {
			return openId !== null;
		},
		select,
		collapse,
		unlock() {
			locked = false;
			paint();
		},
		markUploaded(id, hasImage) {
			const index = HIGHLIGHTS.findIndex((entry) => entry.id === id);
			items[index]?.classList.toggle("has-upload", hasImage);
		},
	};
}
