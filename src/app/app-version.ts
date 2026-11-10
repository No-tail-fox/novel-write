import { version } from '../../package.json';

/** Release version from package.json; never hard-code it in UI (U-1). */
export const APP_VERSION: string = version;
export const APP_VERSION_LABEL = `V${APP_VERSION}`;
