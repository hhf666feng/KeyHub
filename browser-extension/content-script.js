function reportFocus() {
  chrome.runtime.sendMessage({ type: "openkeylet-focus" }).catch(() => {});
}

document.addEventListener("focusin", reportFocus, true);
window.addEventListener("focus", reportFocus, true);

if (document.hasFocus()) reportFocus();
