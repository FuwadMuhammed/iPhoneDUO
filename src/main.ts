import './styles.css';
import type { Highlight } from './device/highlights';
import { requireElement } from './dom';
import { createRail } from './ui/rail';
import { Loader, Notice } from './components';
const notice = new Notice('#notice');
const loader = new Loader('#loader');
// The menu is plain DOM, so it renders straight away. Picks made while the model loads are remembered
// through `rail.current` and the device arrives on whichever highlight is chosen.
let onSelect: (highlight: Highlight) => void = () => {};
const rail = createRail(requireElement('#highlight-list'), requireElement('#highlight-sheet'), (highlight) =>
  onSelect(highlight),
);
async function boot(): Promise<void> {
  loader.setProgress(0.02, 'Loading 3D model');
  let experience: typeof import('./experience');
  try {
    // three.js and the device code live in their own chunk so the page and menu never wait for them.
    experience = await import('./experience');
  } catch (error) {
    console.error(error);
    loader.fail('Could not load the viewer.');
    notice.show('The 3D viewer could not be loaded. Refresh the page to try again.');
    return;
  }
  await experience.start({
    host: requireElement('#stage'),
    rack: requireElement('#highlights'),
    rail,
    notice,
    loader,
    bindSelect(handler) {
      onSelect = handler;
    },
  });
}
void boot();
