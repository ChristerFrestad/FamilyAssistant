// @ts-check
// RFC 7807 Problem Details (https://tools.ietf.org/html/rfc7807)
// Uniform error format across all endpoints.
//
// Response body:
//   {
//     "type": "about:blank",
//     "title": "Validation Error",
//     "status": 400,
//     "detail": "body.name: Required",
//     "instance": "/api/shopping/add"
//   }

/**
 * @typedef {object} HttpErrorOptions
 * @property {number} status - HTTP status code
 * @property {string} title - Short summary (matcher HTTP status text)
 * @property {string} [detail] - Lesbar forklaring
 * @property {string} [type] - URI for feil-type (default 'about:blank')
 * @property {object} [extras] - Ekstra felter som spres inn i problem-body
 */

/**
 * @typedef {object} ProblemDetails
 * @property {string} type
 * @property {string} title
 * @property {number} status
 * @property {string|undefined} detail
 * @property {string} instance
 */

class HttpError extends Error {
  /** @param {HttpErrorOptions} opts */
  constructor({ status, title, detail, type = 'about:blank', extras = {} }) {
    super(detail || title);
    /** @type {number} */
    this.status = status;
    /** @type {string} */
    this.title = title;
    /** @type {string|undefined} */
    this.detail = detail;
    /** @type {string} */
    this.type = type;
    /** @type {object} */
    this.extras = extras;
  }

  /**
   * @param {string} instance - Request path that triggered the error
   * @returns {ProblemDetails & Record<string, any>}
   */
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

// Standard error constructors
const errors = {
  /** @param {string} [detail] @param {object} [extras] */
  badRequest: (detail, extras) =>
    new HttpError({ status: 400, title: 'Bad Request', detail, extras }),
  /** @param {string} [detail] */
  unauthorized: (detail = 'Authentication required') =>
    new HttpError({ status: 401, title: 'Unauthorized', detail }),
  /** @param {string} [detail] */
  forbidden: (detail = 'Forbidden') => new HttpError({ status: 403, title: 'Forbidden', detail }),
  /** @param {string} [detail] */
  notFound: (detail = 'Resource not found') =>
    new HttpError({ status: 404, title: 'Not Found', detail }),
  /** @param {string} [detail] @param {object} [extras] */
  conflict: (detail, extras) => new HttpError({ status: 409, title: 'Conflict', detail, extras }),
  /** @param {string} [detail] */
  payloadTooLarge: (detail) => new HttpError({ status: 413, title: 'Payload Too Large', detail }),
  /** @param {string} [detail] */
  tooManyRequests: (detail) => new HttpError({ status: 429, title: 'Too Many Requests', detail }),
  /** @param {string} [detail] */
  internal: (detail = 'Internal server error') =>
    new HttpError({ status: 500, title: 'Internal Server Error', detail }),
  /** @param {string} [detail] */
  serviceUnavailable: (detail) =>
    new HttpError({ status: 503, title: 'Service Unavailable', detail }),
  /** @param {Array<{path: (string|number)[], message: string, code?: string}>} issues */
  validation: (issues) =>
    new HttpError({
      status: 400,
      title: 'Validation Error',
      detail: issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; '),
      extras: { errors: issues.map((i) => ({ path: i.path, message: i.message, code: i.code })) },
    }),
};

module.exports = { HttpError, errors };
