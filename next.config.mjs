/** @type {import('next').NextConfig} */
const nextConfig = {
  headers: async () => [
    {
      // Apply security headers to every route.
      source: "/:path*",
      headers: [
        // Prevent the page being framed (clickjacking).
        { key: "X-Frame-Options", value: "DENY" },
        // Stop browsers sniffing MIME types.
        { key: "X-Content-Type-Options", value: "nosniff" },
        // Don't send the Referer header to third-party origins — keeps token usage private.
        { key: "Referrer-Policy", value: "same-origin" },
        // Restrict what can run on the page. No inline scripts from external origins.
        {
          key: "Content-Security-Policy",
          value: [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline' 'unsafe-eval'", // Next.js needs these
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data:",
            "connect-src 'self'",  // API calls only go to our own Next.js routes
            "frame-ancestors 'none'",
            "base-uri 'self'",
            "form-action 'self'",
          ].join("; "),
        },
        // Opt out of browser features we don't use.
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      ],
    },
    {
      // API routes: enforce JSON only, prevent caching of sensitive responses.
      source: "/api/:path*",
      headers: [
        { key: "Cache-Control", value: "no-store, no-cache, must-revalidate" },
        { key: "Pragma", value: "no-cache" },
      ],
    },
  ],
};

export default nextConfig;
