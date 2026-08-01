(() => {
  const prefersReducedMotion = () =>
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Menus/dialogs are deliberately excluded: they already get a dedicated
  // entrance animation from styles.css, and double-tagging them here caused
  // two separate opacity/transform animations to run on the same element at
  // once, which looked like a shake.
  const FADE_TARGETS = 'main, article, section';

  function tagForFadeIn(root) {
    if (prefersReducedMotion()) return;
    if (!(root instanceof Element)) return;

    const candidates = root.matches(FADE_TARGETS)
      ? [root, ...root.querySelectorAll(FADE_TARGETS)]
      : [...root.querySelectorAll(FADE_TARGETS)];

    for (const el of candidates) {
      if (el.dataset.caiFaded) continue;
      el.dataset.caiFaded = 'true';
      el.classList.add('cai-fade-in');
    }
  }

  function observeDom() {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          tagForFadeIn(node);
        }
      }
    });

    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  const PRESS_TARGETS =
    'button, [role="button"], [role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="option"], [role="tab"]';

  // The model picker trigger is the floating-ui anchor for its dropdown —
  // getBoundingClientRect() (which anchoring reads) includes CSS transforms,
  // so bouncing the trigger itself reads as the anchor moving and makes the
  // open menu shake to follow it. Instead we bounce an inner wrapper around
  // its content, leaving the real button's own box untouched.
  const BOUNCE_WRAP_TARGET = '[data-testid="model-selector-dropdown"]';

  function getBounceInner(trigger) {
    let wrapper = trigger.querySelector(':scope > .cai-bounce-inner');
    if (wrapper) return wrapper;

    wrapper = document.createElement('span');
    wrapper.className = 'cai-bounce-inner';
    const cs = getComputedStyle(trigger);
    wrapper.style.display = cs.display === 'inline-flex' || cs.display === 'flex' ? 'flex' : 'inline-flex';
    wrapper.style.alignItems = cs.alignItems;
    wrapper.style.justifyContent = cs.justifyContent;
    wrapper.style.gap = cs.gap;
    wrapper.style.width = '100%';
    wrapper.style.height = '100%';
    wrapper.style.minWidth = '0';

    while (trigger.firstChild) wrapper.appendChild(trigger.firstChild);
    trigger.appendChild(wrapper);
    return wrapper;
  }

  function flashPressed(target) {
    const flashTarget = target.matches(BOUNCE_WRAP_TARGET) ? getBounceInner(target) : target;
    flashTarget.classList.remove('cai-pressed');
    void flashTarget.offsetWidth; // force reflow so the animation restarts
    flashTarget.classList.add('cai-pressed');
  }

  function setupPressEffect() {
    if (prefersReducedMotion()) return;

    // Trigger on `pointerdown` first:
    // - Selecting a menu item (e.g. a model in the model switcher) closes
    //   and unmounts the menu synchronously inside its own click handler,
    //   which can happen before the browser ever paints a class added on
    //   click — pointerdown fires earlier and gives the animation a frame
    //   to render before the item is removed.
    // On `click`, only flash again if the pointerdown flash didn't survive
    // (e.g. some trigger buttons wipe className via a re-render inside
    // their own pointerdown handler) — otherwise a normal click would
    // restart the animation a second time and visibly double-bounce.
    const onPointerDown = (e) => {
      const target = e.target instanceof Element ? e.target.closest(PRESS_TARGETS) : null;
      if (target) flashPressed(target);
    };

    const onClick = (e) => {
      const target = e.target instanceof Element ? e.target.closest(PRESS_TARGETS) : null;
      if (!target) return;
      const flashTarget = target.matches(BOUNCE_WRAP_TARGET) ? getBounceInner(target) : target;
      if (!flashTarget.classList.contains('cai-pressed')) flashPressed(target);
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('click', onClick, true);

    document.addEventListener(
      'animationend',
      (e) => {
        if (
          (e.animationName === 'cai-press-pulse' || e.animationName === 'cai-press-pulse-static') &&
          e.target instanceof Element
        ) {
          e.target.classList.remove('cai-pressed');
        }
      },
      true
    );
  }

  function init() {
    tagForFadeIn(document.body);
    observeDom();
    setupPressEffect();
  }

  if (document.body) {
    init();
  } else {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  }
})();
