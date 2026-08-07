import type { Request, Response } from 'express';
import { blockSourceMaps } from './blockSourceMaps';

function mockRes() {
  const res = {
    sendStatus: jest.fn(),
  };
  return res as unknown as Response & { sendStatus: jest.Mock };
}

describe('blockSourceMaps', () => {
  it('returns 404 for .map requests', () => {
    const req = { path: '/client.js.map' } as Request;
    const res = mockRes();
    const next = jest.fn();

    blockSourceMaps(req, res, next);

    expect(res.sendStatus).toHaveBeenCalledWith(404);
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next for non-map assets', () => {
    const req = { path: '/client.js' } as Request;
    const res = mockRes();
    const next = jest.fn();

    blockSourceMaps(req, res, next);

    expect(res.sendStatus).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });
});
