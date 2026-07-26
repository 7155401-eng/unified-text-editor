import app from './index_tidio.js';

/*
 * Deprecated compatibility entry.
 * The production entry point is worker/index_tidio.js.
 * Keep this file as a safe pass-through so old references cannot re-enable
 * account AI key interception or server-key substitution.
 */
export default app;
