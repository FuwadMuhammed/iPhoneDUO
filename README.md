# iPhone Duo Animation

An interactive WebGL preview of a book-fold handset, built with TypeScript, Vite and three.js.

> Built with the help of [Stele](https://stele.so) - a canvas for frontend devs and designers to collect references, screens and inspiration in one place as code.

https://github.com/user-attachments/assets/af727494-1789-42be-868a-bcddf8f3c3fc

## Run

```sh
npm install
npm run dev        # http://127.0.0.1:5311
npm run build      # typecheck and production bundle in dist/
npm run preview
```

## Controls

- **Highlights** down the left side. Choosing one turns the pill into its description and settles the device into the matching fold, tilt and camera framing.
- **Up and down arrows** move through the highlights in order.
- **Slider**, inside the opening highlight, sets the fold by hand from shut (left) to flat open (right).
- **Drag** to rotate and **scroll** to zoom.
- **Reset** (top right) returns the current highlight to its framing.
- **Upload custom image** places your image across both displays and opens the device.

## How it works

- Each highlight is a row of data: an `openness`, a device tilt and a camera framing. Choosing one starts an eased move that reads its start from wherever the device currently is, so a second choice interrupts the first rather than queueing behind it.
- One value, `openness` from 0 to 1, drives the hinge angle, the wallpaper framing, the display blur and dimming, and how far the device slides to stay clear of the rail.
- The cover half rotates about the hinge in the vertex shader, and the flexible display bends through a short Hermite strip. Shading normals turn across a wider band than the geometry does, so the fold reads as a smooth curve.
- Both displays sample one wallpaper through a shared frame that pans with the fold, so the two screens read as a single continuous image. The wallpaper is three sheets — sky, ridge and dune — and shutting the phone pushes each in by its own share of the travel, so the landscape gains depth as it folds. The clock is split to sit inside that stack: the date and time fall behind the ridge while the status glyph, buttons and home indicator stay in front of everything.
- Each display fragment projects its folded position back onto the flat inner display plane. The projection follows the live camera, so zooming does not slide the image across the glass, and eases back to the panel's own UVs as the view leaves a head-on framing, so a steep orbit cannot push the image off the display it belongs to.
- Highlights that stand the device on its side carry lock screen art composed for a tall frame and turned into the wide display buffer, so the clock still reads the right way up.
- A soft highlight sweeps across the cover glass as it turns.

## Layout

```
public/assets/   model, model textures and lock screen images
src/device/      model loading, fold shaders, display images and highlight data
src/stage/       renderer, lighting, camera, framing and device pose
src/ui/          the highlight rail and its open and close animation
src/main.ts      page wiring and interaction
src/styles.css   page styles
```

## License

MIT. See [LICENSE](LICENSE).
