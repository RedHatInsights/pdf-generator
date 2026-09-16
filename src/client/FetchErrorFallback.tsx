export const RENDER_FAILED = 'The report failed to render.';

type ErrorWithMessage = { message: string };

function isErrorWithMessage(error: unknown): error is ErrorWithMessage {
  return (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string'
  );
}

function FetchErrorFallback({ error }: { error?: unknown }) {
  let content = null;
  try {
    if (error instanceof Error) {
      content = <div>{error.message || RENDER_FAILED}</div>;
    } else if (typeof error === 'string') {
      content = <div>{error || RENDER_FAILED}</div>;
    } else if (isErrorWithMessage(error)) {
      content = <div>{error.message || RENDER_FAILED}</div>;
    } else {
      // Passed as ScalprumComponent's ErrorComponent this renders with no error
      // prop at all, and JSON.stringify(undefined) returns undefined — an empty
      // #crc-pdf-generator-err that Puppeteer cannot tell from a healthy page.
      content = <div>{JSON.stringify(error, null, 2) || RENDER_FAILED}</div>;
    }
  } catch {
    content = <div>Something went wrong</div>;
  }
  return <div id="crc-pdf-generator-err">{content}</div>;
}

export default FetchErrorFallback;
