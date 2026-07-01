const sideEffectActions = new Set([
    "submitForm",
    "purchase",
    "sendMessage",
    "click",
    "fill"
]);
export function isSideEffectAction(action) {
    return sideEffectActions.has(action);
}
