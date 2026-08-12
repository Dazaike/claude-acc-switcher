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

  let upgradeModelTaggingQueued = false;

  function scheduleUpgradeModelTagging() {
    if (upgradeModelTaggingQueued) return;
    upgradeModelTaggingQueued = true;
    queueMicrotask(() => {
      upgradeModelTaggingQueued = false;
      const modelMenus = [...document.querySelectorAll('[role="menu"], [role="listbox"], [role="dialog"]')]
        .filter((menu) => menu.textContent?.includes('Upgrade'));

      for (const menu of modelMenus) {
        for (const option of menu.querySelectorAll(MODEL_OPTIONS)) {
          option.classList.toggle('cai-upgrade-model', option.textContent?.includes('Upgrade'));
        }
      }
    });
  }

  function observeDom() {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          tagForFadeIn(node);
        }
      }
      scheduleUpgradeModelTagging();
    });

    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  const PRESS_TARGETS =
    'button, [role="button"], [role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="option"], [role="tab"]';

  // The model picker is a floating-ui anchor, so its own box must not move.
  // Animate a content wrapper instead; it preserves the menu's anchor while
  // retaining press feedback.
  const MODEL_PICKER_TRIGGER = '[data-testid="model-selector-dropdown"]';

  const SETTINGS_KEY = 'cas_ext_settings';
  const MODEL_OPTIONS = '[role="menuitemradio"], [role="menuitem"], [role="option"], button';

  function applyHideUpgradeModels(enabled) {
    document.documentElement.dataset.caiHideUpgradeModels = String(enabled);
    scheduleUpgradeModelTagging();
  }

  async function loadModelPickerSettings() {
    try {
      const stored = await chrome.storage.local.get(SETTINGS_KEY);
      applyHideUpgradeModels(stored[SETTINGS_KEY]?.hideUpgradeModels !== false);
    } catch {
      applyHideUpgradeModels(true);
    }

    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local' || !changes[SETTINGS_KEY]) return;
      applyHideUpgradeModels(changes[SETTINGS_KEY].newValue?.hideUpgradeModels !== false);
    });
  }

  function selectorBounceInner(trigger) {
    let wrapper = trigger.querySelector(':scope > .cai-bounce-inner');
    if (wrapper) return wrapper;

    wrapper = document.createElement('span');
    wrapper.className = 'cai-bounce-inner';
    wrapper.style.display = getComputedStyle(trigger).display === 'flex' ? 'flex' : 'inline-flex';
    wrapper.style.alignItems = 'inherit';
    wrapper.style.justifyContent = 'inherit';
    while (trigger.firstChild) wrapper.appendChild(trigger.firstChild);
    trigger.appendChild(wrapper);
    return wrapper;
  }

  function flashPressed(target) {
    const flashTarget = target.matches(MODEL_PICKER_TRIGGER)
      ? selectorBounceInner(target)
      : target;
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
      const flashTarget = target.matches(MODEL_PICKER_TRIGGER)
        ? selectorBounceInner(target)
        : target;
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
    loadModelPickerSettings();
  }

  if (document.body) {
    init();
  } else {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  }
})();
