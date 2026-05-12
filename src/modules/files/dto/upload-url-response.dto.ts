/**
 * Returned by `POST /v1/uploads`. The client:
 *   1. PUTs the file body to `uploadUrl` (uses `token` per Supabase Storage
 *      conventions if needed — see https://supabase.com/docs/reference/javascript/storage-createsignedurl).
 *   2. After the PUT succeeds, posts `path` back to the relevant resource
 *      endpoint (KYC: fileUrl=path; sellers: profilePhotoUrl=path; etc.).
 *
 * `path` is the bucket-prefixed object key (e.g. "avatars/<uid>/<ulid>") —
 * the same convention the *Url columns on the schema use, so the value can
 * be stored verbatim.
 */
export interface UploadUrlResponseDto {
  uploadUrl: string;
  token: string;
  path: string;
  bucket: string;
}
