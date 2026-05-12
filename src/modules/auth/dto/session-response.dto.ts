/** Wire shape returned by every endpoint that yields a session. */
export interface SessionResponseDto {
  accessToken: string;
  refreshToken: string;
  /** Unix seconds. */
  expiresAt: number;
  user: {
    id: string;
    email: string | null;
    phone: string | null;
    emailConfirmedAt: string | null;
    phoneConfirmedAt: string | null;
  };
}
