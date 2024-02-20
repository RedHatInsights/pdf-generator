import httpContext from 'express-http-context';
import type { Handler } from 'express';
import { apiLogger } from '../common/logging';

import config from '../common/config';

const identityMiddleware: Handler = (req, _res, next) => {
  try {
    const rhIdentity = req.headers[config?.IDENTITY_HEADER_KEY];
    if (rhIdentity) {
      const identityObject = JSON.parse(
        Buffer.from(rhIdentity as string, 'base64').toString()
      );
      apiLogger.debug(`Identity Header: ${JSON.stringify(identityObject)}`);
      // We are using ACCOUNT_ID here because it matches the window's auth shape.
      // The API Token uses `identity.user.user_id` and corresponds to `internal.account_id`
      // in the window.
      const accountID = identityObject?.identity?.user?.user_id;
      httpContext.set(config?.IDENTITY_HEADER_KEY, rhIdentity);
      httpContext.set(config?.IDENTITY_CONTEXT_KEY, identityObject);
      httpContext.set(config?.ACCOUNT_ID, accountID);
    }
    next();
  } catch (error) {
    apiLogger.error(error);
    next();
  }
};

export default identityMiddleware;
