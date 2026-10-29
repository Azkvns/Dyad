export function listenOptions(env: { PORT: number }) {
  return { host: "0.0.0.0" as const, port: env.PORT };
}
