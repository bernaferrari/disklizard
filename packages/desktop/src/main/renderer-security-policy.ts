const rendererContentSecurityDirectives = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "media-src 'self' data: blob:",
  // PDF previews are bounded local bytes emitted as data: URLs. No remote or
  // blob frame origin is permitted.
  "frame-src data:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
]

// Packaged and oc:// renderer documents. No inline scripts.
export const RENDERER_CONTENT_SECURITY_POLICY = rendererContentSecurityDirectives.join("; ")

// `electron-vite dev` serves HTML from Vite, and @vitejs/plugin-react prepends
// the refresh preamble as an inline module script. The packaged policy blocks
// that script, so the dev window never finishes booting React.
const devRendererContentSecurityDirectives = rendererContentSecurityDirectives.map((directive) =>
  directive === "script-src 'self'" ? "script-src 'self' 'unsafe-inline'" : directive,
)

export const RENDERER_DEV_CONTENT_SECURITY_POLICY = devRendererContentSecurityDirectives.join("; ")

export function rendererContentSecurityPolicy(devServer: boolean) {
  return devServer ? RENDERER_DEV_CONTENT_SECURITY_POLICY : RENDERER_CONTENT_SECURITY_POLICY
}
