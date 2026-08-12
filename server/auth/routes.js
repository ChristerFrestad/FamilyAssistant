// HTTP endpoints for authentication flows.
//
// Registered from server/routes.js via registerAuthRoutes(router, { repos }).
// Every path under /api/auth/* is treated as public by the authenticate
// middleware (see auth/middleware.js), so these handlers never see ctx.user
// unless a real session cookie is present.
