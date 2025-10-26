const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const allowedTags = new Set(["B", "STRONG", "I", "EM", "BR"]);

export const sanitizeRichText = (value: unknown): string => {
  if (typeof value !== "string") {
    if (value === null || value === undefined) {
      return "";
    }
    return escapeHtml(String(value));
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  if (typeof window === "undefined" || typeof window.DOMParser === "undefined") {
    return escapeHtml(trimmed);
  }

  const parser = new DOMParser();
  const documentWrapper = parser.parseFromString(`<div>${trimmed}</div>`, "text/html");
  const root = documentWrapper.body;

  const cleanse = (node: Node): void => {
    const childNodes = Array.from(node.childNodes);
    for (const child of childNodes) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const element = child as HTMLElement;
        if (!allowedTags.has(element.tagName)) {
          const parent = element.parentNode;
          while (element.firstChild) {
            parent?.insertBefore(element.firstChild, element);
          }
          parent?.removeChild(element);
          continue;
        }
        while (element.attributes.length > 0) {
          element.removeAttribute(element.attributes[0].name);
        }
      }
      cleanse(child);
    }
  };

  cleanse(root);
  return root.innerHTML;
};

export const ensurePlainText = (value: unknown): string => {
  if (typeof value === "string") {
    return value.trim();
  }
  if (value === null || value === undefined) {
    return "";
  }
  return String(value).trim();
};
