/**
 * Where a Select inside an admin drawer renders its popup: the trigger's parent, so the popup stays in the drawer's
 * body. antd Select `getPopupContainer` ("When position issues happen, try to modify it into scrollable content"; the
 * Select FAQ: "if you … need to trigger Select in other popup layers, please try to use
 * `getPopupContainer={triggerNode => triggerNode.parentElement}`"). On a phone a multiple-select popup in <body> sat
 * past the screen's edge and shifted the page, so the drawer's mask took the next click (the groups and app drawers).
 */
export const drawerPopupContainer = (trigger: HTMLElement): HTMLElement =>
	trigger.parentElement ?? document.body
