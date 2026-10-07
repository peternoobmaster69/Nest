(() => {
  /** @param {string} key @param {Record<string, string>} messages */
  function staticPageText(key, messages = globalThis.NestStaticPage.messages) {
    if (!Object.hasOwn(messages, key) || typeof messages[key] !== "string") {
      throw new Error(`Missing static-page message: ${key}`);
    }
    return messages[key];
  }

  function expandMessage(value, messages) {
    return value.replace(/\{\{([\w.]+)}}/g, (_, key) => staticPageText(key, messages));
  }

  const TEXT_ATTRIBUTES = ["aria-label", "title", "placeholder", "alt"];

  /** Resolve resource references as text, preserving markup and refusing missing translations.
   * @param {Document} document
   * @param {Record<string, string>} messages
   */
  function renderStaticPageCopy(document, messages = globalThis.NestStaticPage.messages) {
    const walker = document.createTreeWalker(document.documentElement, 4 /* NodeFilter.SHOW_TEXT */);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.parentElement?.closest("script, style")) continue;
      node.textContent = expandMessage(node.textContent, messages);
    }
    for (const element of document.querySelectorAll("[aria-label], [title], [placeholder], [alt]")) {
      for (const attribute of TEXT_ATTRIBUTES) {
        const value = element.getAttribute(attribute);
        if (value !== null) element.setAttribute(attribute, expandMessage(value, messages));
      }
    }
  }

  globalThis.NestStaticPage = Object.freeze({ ...globalThis.NestStaticPage, renderStaticPageCopy, staticPageText });
})();
