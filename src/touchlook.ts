/**
 * Faster looking around on touch screens. Street View turns about 90° for a
 * full-width swipe on a phone, so turning round takes several swipes. This
 * takes over one-finger drags (Street View listens to touch events, not
 * pointer events) and turns DEG_PER_WIDTH for a full-width swipe instead.
 *
 * Taps still reach Street View (arrows, tap-to-move): nothing is taken over
 * until the finger has moved DRAG_START_PX. Two-finger pinches are left alone.
 * Mouse dragging isn't touched.
 */
const DEG_PER_WIDTH = 220;
const DRAG_START_PX = 8;

export function speedUpTouchLook(el: HTMLElement, getPano: () => google.maps.StreetViewPanorama | null) {
  let drag: { id: number; x0: number; y0: number; heading: number; pitch: number; active: boolean } | null = null;

  el.addEventListener(
    "touchstart",
    (e) => {
      const pano = getPano();
      if (e.touches.length !== 1 || !pano) {
        drag = null; // a second finger: it's a pinch, leave it to Street View
        return;
      }
      const t = e.touches[0];
      const pov = pano.getPov();
      drag = { id: t.identifier, x0: t.clientX, y0: t.clientY, heading: pov.heading, pitch: pov.pitch, active: false };
    },
    { capture: true, passive: true },
  );

  el.addEventListener(
    "touchmove",
    (e) => {
      if (!drag || e.touches.length !== 1) return;
      const t = [...e.touches].find((x) => x.identifier === drag!.id);
      const pano = getPano();
      if (!t || !pano) return;
      const dx = t.clientX - drag.x0;
      const dy = t.clientY - drag.y0;
      if (!drag.active && Math.hypot(dx, dy) < DRAG_START_PX) return;
      drag.active = true;
      // Ours now: Street View doesn't see this drag at all.
      e.preventDefault();
      e.stopPropagation();
      // Zoomed in, the same swipe should turn less.
      const perPx = DEG_PER_WIDTH / (el.clientWidth || 375) / 2 ** Math.max(0, pano.getZoom() - 1);
      pano.setPov({
        heading: drag.heading - dx * perPx,
        pitch: Math.max(-85, Math.min(85, drag.pitch + dy * perPx)),
      });
    },
    { capture: true, passive: false },
  );

  const end = (e: TouchEvent) => {
    // Swallow the end of a drag we handled, so Street View doesn't take it as a tap.
    if (drag?.active) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (e.touches.length === 0) drag = null;
  };
  el.addEventListener("touchend", end, { capture: true, passive: false });
  el.addEventListener("touchcancel", end, { capture: true, passive: false });
}
