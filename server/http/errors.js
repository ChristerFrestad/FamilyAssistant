// RFC 7807 Problem Details (https://tools.ietf.org/html/rfc7807)
// Ensartet feilformat p\u00e5 alle endepunkter.
//
// Response body:
//   {
//     "type": "about:blank",
//     "title": "Validation Error",
//     "status": 400,
//     "detail": "body.name: Required",
//     "instance": "/api/shopping/add"
//   }

class HttpError extends Error {
  constructor({ status, title, detail, type = 'about:blank', extras = {} }) {
    super(detail || title);
    this.status = status;
    this.title = title;
    this.detail = detail;
    this.type = type;
    this.extras = extras;
  }

  toProblem(instance) {
    return {
      type: this.type,
      title: this.title,
      status: this.status,
      detail: this.detail,
      instance,
      ...this.extras,
    };
  }
}

// Standard feil-konstrukt\u00f8rer
const errors = {
  badRequest: (detail, extras) => new HttpError({ status: 400, title: 'Bad Request', detail, extras }),
  unauthorized: (detail = 'Authentication required') => new HttpError({ status: 401, title: 'Unauthorized', detail }),
  forbidden: (detail = 'Forbidden') => new HttpError({ status: 403, title: 'Forbidden', detail }),
  notFound: (detail = 'Resource not found') => new HttpError({ status: 404, title: 'Not Found', detail }),
  conflict: (detail) => new HttpError({ status: 409, title: 'Conflict', detail }),
  payloadTooLarge: (detail) => new HttpError({ status: 413, title: 'Payload Too Large', detail }),
  tooManyRequests: (detail) => new HttpError({ status: 429, title: 'Too Many Requests', detail }),
  internal: (detail = 'Internal server error') => new HttpError({ status: 500, title: 'Internal Server Error', detail }),
  serviceUnavailable: (detail) => new HttpError({ status: 503, title: 'Service Unavailable', detail }),
  validation: (issues) => new HttpError({
    status: 400,
    title: 'Validation Error',
    detail: issues.map(i => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; '),
    extras: { errors: issues.map(i => ({ path: i.path, message: i.message, code: i.code })) },
  }),
};

module.exports = { HttpError, errors };
