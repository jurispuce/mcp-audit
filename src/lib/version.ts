/** App version: set at build time through the APP_VERSION build argument, otherwise "dev". */
export const APP_VERSION: string = process.env.APP_VERSION?.trim() || 'dev';
