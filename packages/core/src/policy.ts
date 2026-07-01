const sideEffectActions = new Set([
  "submitForm",
  "purchase",
  "sendMessage",
  "click",
  "fill"
]);

export function isSideEffectAction(action: string): boolean {
  return sideEffectActions.has(action);
}
