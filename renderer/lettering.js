/* Bricktone tilts a separate ink span because Chromium's CJK fallback does
   not consistently synthesize oblique glyphs. Control hit boxes stay upright. */
function initLettering() {
  const excluded = 'script, style, title, textarea, select, option, svg, [contenteditable], .lettering-ink';
  const paint = (root) => {
    if (!root.isConnected) return;
    const texts = [];
    const collect = (node) => {
      if (node.nodeType === Node.TEXT_NODE && node.textContent.trim() && !node.parentElement?.closest(excluded)) texts.push(node);
    };
    if (root.nodeType === Node.TEXT_NODE) collect(root);
    else {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) collect(walker.currentNode);
    }
    for (const text of texts) {
      const ink = document.createElement('span');
      ink.className = 'lettering-ink';
      text.before(ink);
      ink.append(text);
    }
  };
  const observer = new MutationObserver((changes) => {
    observer.disconnect();
    for (const change of changes) {
      if (change.type === 'characterData') paint(change.target);
      else change.addedNodes.forEach(paint);
    }
    observe();
  });
  const observe = () => observer.observe(document.body, {childList: true, subtree: true, characterData: true});
  paint(document.body);
  observe();
}
