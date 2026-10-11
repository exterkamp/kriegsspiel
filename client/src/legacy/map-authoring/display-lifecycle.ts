/** Keep a cached page alive and re-arm DPR observation after each display change. */
export function observeDisplayLifecycle(
  target: Window,
  redraw: () => void,
  dispose: () => void,
): () => void {
  let resolution: MediaQueryList;
  const onResolution = () => {
    watchResolution();
    redraw();
  };
  function watchResolution(): void {
    resolution?.removeEventListener('change', onResolution);
    resolution = target.matchMedia(`(resolution: ${target.devicePixelRatio || 1}dppx)`);
    resolution.addEventListener('change', onResolution);
  }
  const onShow = (event: PageTransitionEvent) => {
    if (event.persisted) {
      watchResolution();
      redraw();
    }
  };
  const onHide = (event: PageTransitionEvent) => {
    if (!event.persisted) dispose();
  };
  watchResolution();
  target.addEventListener('resize', redraw);
  target.addEventListener('pageshow', onShow);
  target.addEventListener('pagehide', onHide);
  return () => {
    resolution.removeEventListener('change', onResolution);
    target.removeEventListener('resize', redraw);
    target.removeEventListener('pageshow', onShow);
    target.removeEventListener('pagehide', onHide);
  };
}
