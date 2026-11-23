# Error envelope contract

All HTTP failures use the same response shape: `statusCode`, `message`,
`code`, `errors`, `timestamp`, and `path`.

- Validation failures use `BAD_REQUEST` and preserve only public validation
  messages in `errors`.
- Provider outages use `PROVIDER_ERROR` with a generic message and the
  upstream 5xx status. Provider payloads and credentials are not returned.
- Unexpected failures use `INTERNAL_SERVER_ERROR` and the generic internal
  message.

Clients should branch on `code` and `statusCode`, not provider-specific error
text. The filter logs the request method, path, status, and safe public
message for server-side diagnosis.
