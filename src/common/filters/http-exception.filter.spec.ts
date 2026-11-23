import { HttpException, HttpStatus } from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter';

describe('HttpExceptionFilter', () => {
  const response = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ method: 'POST', url: '/v1/payments' }),
      getResponse: () => response,
    }),
  };

  beforeEach(() => jest.clearAllMocks());

  it('normalizes validation exceptions into the public error envelope', () => {
    new HttpExceptionFilter().catch(
      new HttpException(
        { message: ['amount must be a string'], error: 'Bad Request' },
        HttpStatus.BAD_REQUEST,
      ),
      host as never,
    );

    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        message: ['amount must be a string'],
        errors: ['amount must be a string'],
        code: 'BAD_REQUEST',
      }),
    );
  });

  it('normalizes provider outages without exposing upstream details', () => {
    new HttpExceptionFilter().catch(
      {
        response: {
          status: 503,
          data: { message: 'database host, query, and credential details' },
        },
      },
      host as never,
    );

    const body = response.json.mock.calls[0][0];
    expect(body).toMatchObject({
      statusCode: 503,
      message: 'Upstream provider unavailable',
      code: 'PROVIDER_ERROR',
    });
    expect(JSON.stringify(body)).not.toContain('credential details');
  });

  it('gives unknown failures a stable internal error code', () => {
    new HttpExceptionFilter().catch(
      new Error('private implementation detail'),
      host as never,
    );

    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 500,
        message: 'Internal server error',
        code: 'INTERNAL_SERVER_ERROR',
      }),
    );
  });
});
