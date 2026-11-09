/** Which production route the user picked on the creation screen. Both routes share the creative project page. */
export type CreativeRoute = 'lemo' | 'template';
let requested: CreativeRoute | undefined;
export function requestCreativeRoute(route: CreativeRoute) { requested = route; }
/** Pure read, safe inside (StrictMode double-invoked) state initializers. */
export function peekCreativeRoute(): CreativeRoute | undefined { return requested; }
/** Clear after the creation form has mounted; later visits fall back to the Lemo route. */
export function clearCreativeRoute() { requested = undefined; }
export const creativeRouteMode = (route: CreativeRoute | undefined): 'ai-code' | 'template' => route === 'template' ? 'template' : 'ai-code';
