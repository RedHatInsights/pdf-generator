import { Request } from 'express';
import { PreviewReqBody, PreviewReqQuery } from '../common/types';

export const replaceString = (string: string) => {
  return string.replace(/[-[\]{}()'`*+?.,\\^$|#]/g, '\\$&');
};

export const processOrientationOption = (
  request: Request<unknown, unknown, PreviewReqBody, PreviewReqQuery>
) => {
  let orientationOption = '';
  if (request.query?.orientation) {
    orientationOption = request.query?.orientation;
  } else if (request.body?.orientation) {
    orientationOption = request.body?.orientation;
  }

  if (orientationOption === 'landscape') {
    return true;
  }

  return undefined;
};
