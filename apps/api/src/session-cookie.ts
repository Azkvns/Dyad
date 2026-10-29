export function sessionCookieOptions(nodeEnv: string | undefined) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
    secure: nodeEnv === "production",
  };
}
