import httpContext from 'express-http-context';
import type { Handler } from 'express';
import { apiLogger } from '../common/logging';

import config from '../common/config';

const identityMiddleware: Handler = (req, _res, next) => {
  try {
    const rhIdentity = req.header(config.IDENTITY_HEADER_KEY);
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
    if (req.cookies[config.JWT_COOKIE_NAME]) {
      httpContext.set(
        config.JWT_COOKIE_NAME,
        req.cookies[config.JWT_COOKIE_NAME],
      );
    }
    next();
  } catch (error) {
    apiLogger.error(error);
    next();
  }
};

export default identityMiddleware;
