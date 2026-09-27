/**
 * Shared logo limits.
 *
 * Kept in its own module (no "use client") so the API route can import the same
 * numbers the browser does — a server module must not pull from a client
 * boundary. Keeping the two in sync is what stops the server from accepting a
 * payload the client would have rejected.
 */

/** Reject oversized files before doing any decoding work. */
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

/**
 * Cap on the stored data-URL length. Base64 inflates binary by ~4/3, so a
 * MAX_UPLOAD_BYTES PNG can serialize to roughly 1.37x that.
 */
export const MAX_STORED_LOGO_CHARS = Math.ceil(MAX_UPLOAD_BYTES * 1.4);
