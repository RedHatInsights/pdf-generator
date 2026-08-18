import httpContext from 'express-http-context';
import type { Handler } from 'express';
import { apiLogger, formatLogError } from '../common/logging';
import { logAuthFailure } from '../common/securityLog';

import config from '../common/config';

const identityMiddleware: Handler = (req, _res, next) => {
  try {
    const rhIdentity = req.header(config.IDENTITY_HEADER_KEY);
    if (!rhIdentity) {
      logAuthFailure('Missing x-rh-identity header', req.originalUrl);
    }
    if (rhIdentity) {
      const identityObject = JSON.parse(
        Buffer.from(rhIdentity, 'base64').toString(),
      );
      // We are using ACCOUNT_ID here because it matches the window's auth shape.
      // The API Token uses `identity.user.user_id` and corresponds to `internal.account_id`
      // in the window.
      const accountID = identityObject?.identity?.user?.user_id;
      httpContext.set(config?.IDENTITY_HEADER_KEY, rhIdentity);
      httpContext.set(config?.IDENTITY_CONTEXT_KEY, identityObject);
      httpContext.set(config?.ACCOUNT_ID, accountID);
    }
    if (req.header(config.AUTHORIZATION_HEADER_KEY)) {
      httpContext.set(
        config.AUTHORIZATION_CONTEXT_KEY,
        req.header(config.AUTHORIZATION_HEADER_KEY),
      );
    }
    if (req.header(config.REFRESH_TOKEN_HEADER_KEY)) {
      httpContext.set(
        config.REFRESH_TOKEN_CONTEXT_KEY,
        req.header(config.REFRESH_TOKEN_HEADER_KEY),
      );
    }
    if (req.cookies[config.JWT_COOKIE_NAME]) {
      httpContext.set(
        config.JWT_COOKIE_NAME,
        req.cookies[config.JWT_COOKIE_NAME],
      );
    }
    next();
  } catch (error) {
    apiLogger.error(`Identity middleware error: ${formatLogError(error)}`);
    logAuthFailure('Failed to decode identity header', req.originalUrl);
    next();
  }
};

export default identityMiddleware;
