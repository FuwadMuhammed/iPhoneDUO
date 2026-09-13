export function requireElement<T extends Element = HTMLElement>(selector: string, within: ParentNode = document): T {
  const found = within.querySelector<T>(selector);
  if (!found) throw new Error(`Missing element "${selector}".`);
  return found;
}
