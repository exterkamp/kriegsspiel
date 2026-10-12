/** Keep a cached page alive and re-arm DPR observation after each display change. */
export function observeDisplayLifecycle(
  target: Window,
  redraw: () => void,
  dispose: () => void,
): () => void {
  let resolution: MediaQueryList | undefined;
  let stopped = false;
  let releaseResolution: (() => void) | undefined;
  const registrations: (() => void)[] = [];
  const stop = () => {
    if (stopped) return;
    stopped = true;
    try {
      releaseResolution?.();
    } catch {
      /* Continue with window registrations. */
    }
    releaseResolution = undefined;
    resolution = undefined;
    for (const release of registrations.splice(0).reverse()) {
      try {
        release();
      } catch {
        /* Release every independent registration. */
      }
    }
  };
  const onResolution = () => {
    if (stopped) return;
    watchResolution();
    redraw();
  };
  function watchResolution(): void {
    releaseResolution?.();
    releaseResolution = undefined;
    resolution = undefined;
    resolution = target.matchMedia(`(resolution: ${target.devicePixelRatio || 1}dppx)`);
    const current = resolution;
    // Reserve removal before registration, even if a port throws after registering.
    releaseResolution = () => current.removeEventListener('change', onResolution);
    resolution.addEventListener('change', onResolution);
  }
  const onShow = (event: PageTransitionEvent) => {
    if (!stopped && event.persisted) {
      watchResolution();
      redraw();
    }
  };
  const onHide = (event: PageTransitionEvent) => {
    if (!stopped && !event.persisted) dispose();
  };
  const onResize = () => {
    if (!stopped) redraw();
  };
  function register<K extends keyof WindowEventMap>(
    name: K,
    handler: (event: WindowEventMap[K]) => void,
  ): void {
    registrations.push(() => target.removeEventListener(name, handler));
    target.addEventListener(name, handler);
  }
  try {
    watchResolution();
    register('resize', onResize);
    register('pageshow', onShow);
    register('pagehide', onHide);
  } catch (error) {
    stop();
    throw error;
  }
  return stop;
}
