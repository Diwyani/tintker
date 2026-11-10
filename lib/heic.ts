/** Whether a file is HEIC / HEIF (iPhone photos), by type or by name. */
export const looksLikeHeic = (f: Blob) => /image\/hei[cf]/i.test(f.type) || (f instanceof File && /\.(heic|heif)$/i.test(f.name));
