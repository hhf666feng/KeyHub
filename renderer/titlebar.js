(function () {
  const controls = new Set(['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'A', 'LABEL', 'SUMMARY']);
  const roles = new Set([
    'button', 'link', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'tab',
    'checkbox', 'radio', 'switch', 'option', 'textbox', 'searchbox', 'slider',
    'combobox', 'listbox', 'spinbutton', 'treeitem', 'scrollbar', 'gridcell',
  ]);

  function install({ element, invoke, isMacOS, onError }) {
    if (!isMacOS || !element) return;

    const document = element.ownerDocument;
    const view = document.defaultView;
    let gesture = null;
    let inFlight = false;

    function isTitleContent(event) {
      const path = event.composedPath();
      if (!path.includes(element)) return false;
      return !path.some(node => {
        if (!node.getAttribute) return false;
        const editable = node.getAttribute('contenteditable');
        const tabindex = node.getAttribute('tabindex');
        return controls.has(node.tagName)
          || node.getAttribute('data-tauri-drag-region') === 'false'
          || (editable !== null && editable.toLowerCase() !== 'false')
          || (tabindex !== null && tabindex !== '-1')
          || (node.getAttribute('role') || '').toLowerCase().split(/\s+/).some(role => roles.has(role));
      });
    }

    function unmodifiedLeft(event) {
      return event.button === 0 && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
    }

    function moved(event) {
      return ['clientX', 'clientY', 'screenX', 'screenY'].some(key => Math.abs(event[key] - gesture[key]) > 3);
    }

    function cancel() {
      gesture = null;
    }

    function report(error) {
      try {
        if (onError) onError(error);
      } catch (_) {}
    }

    function maximize() {
      if (inFlight) return;
      inFlight = true;
      Promise.resolve().then(() => invoke('window_action', { action: 'maximize' }))
        .catch(report)
        .finally(() => { inFlight = false; });
    }

    view.addEventListener('mousedown', cancel, true);
    view.addEventListener('mousemove', event => {
      if (gesture && (moved(event) || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)) cancel();
    }, true);
    view.addEventListener('mouseup', event => {
      if (!isTitleContent(event) || !unmodifiedLeft(event) || event.detail !== 2) cancel();
    }, true);
    view.addEventListener('blur', cancel);
    view.addEventListener('pointercancel', cancel, true);
    document.addEventListener('visibilitychange', cancel);

    element.addEventListener('mousedown', event => {
      if (!isTitleContent(event) || !unmodifiedLeft(event)) return;
      event.preventDefault();
      if (event.detail !== 2) return;
      event.stopImmediatePropagation();
      gesture = Object.fromEntries(['clientX', 'clientY', 'screenX', 'screenY'].map(key => [key, event[key]]));
    }, true);

    element.addEventListener('mouseup', event => {
      if (!isTitleContent(event) || !unmodifiedLeft(event) || event.detail !== 2) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const accepted = gesture && !moved(event);
      cancel();
      if (accepted) maximize();
    }, true);

    for (const type of ['selectstart', 'dragstart']) {
      element.addEventListener(type, event => {
        if (isTitleContent(event)) event.preventDefault();
      });
    }
  }

  window.KeyHubTitlebar = { install };
})();
