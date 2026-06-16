import { ConclaveError, RecoveryAction } from '../errors/ErrorReport';
import { TransportError } from './http';
import { Provider } from './types';

// Maps provider transport/HTTP/parse failures onto the Phase 1 taxonomy with the
// correct edge-case catalog code and an actionable recovery. Pure — no IO.

const UPDATE_KEY: RecoveryAction = { label: 'Update key', kind: 'configure', command: 'conclave.manageKeys' };
const ADD_PROVIDER: RecoveryAction = { label: 'Add another provider', kind: 'add', command: 'conclave.manageKeys' };
const RETRY: RecoveryAction = { label: 'Retry', kind: 'retry' };
const DIFFERENT_MODEL: RecoveryAction = { label: 'Try a different model', kind: 'switch' };
const WAIT: RecoveryAction = { label: 'Wait and retry', kind: 'wait' };

/** Network-level failure (DNS/refused/timeout) -> connectivity or timeout. */
export function mapTransportError(err: TransportError, provider: Provider): ConclaveError {
  if (err.kind === 'timeout') {
    return new ConclaveError({
      category: 'provider',
      code: 'PROV-4',
      title: `${provider.label} timed out`,
      detail: 'The request took too long and was aborted.',
      cause: err.cause,
      recoveryActions: [RETRY, ADD_PROVIDER],
      canRetry: true,
    });
  }
  return new ConclaveError({
    category: 'connectivity',
    code: 'SETUP-8',
    title: 'No connection to the provider',
    detail: `Could not reach ${provider.label}. Check your internet connection.`,
    cause: err.cause,
    recoveryActions: [RETRY],
    canRetry: true,
  });
}

/** Non-2xx HTTP status -> typed error. `body` is provider error text (redacted later). */
export function mapHttpError(status: number, provider: Provider, body = ''): ConclaveError {
  const low = body.toLowerCase();

  if (status === 401 || status === 403) {
    // 403 can be geo-block; distinguish by body hint.
    if (/region|country|location|unsupported_country|geo/.test(low)) {
      return geoBlocked(provider);
    }
    return new ConclaveError({
      category: 'setup',
      code: 'SETUP-2',
      title: `${provider.label} rejected the API key`,
      detail: 'The key is missing, invalid, expired, or revoked.',
      recoveryActions: [UPDATE_KEY, ADD_PROVIDER],
      canRetry: false,
    });
  }

  if (status === 402 || /insufficient|quota|credit|billing|payment|exceeded your current/.test(low)) {
    if (provider.kind === 'paid') {
      return new ConclaveError({
        category: 'provider',
        code: 'PROV-13',
        title: `${provider.label} billing problem`,
        detail: 'The paid account could not be charged or hit its limit. Falling back to free providers.',
        recoveryActions: [{ label: 'Switch to free', kind: 'switch', command: 'conclave.manageKeys' }, UPDATE_KEY],
        canRetry: false,
        fallbackApplied: 'Paid provider disabled; using free providers.',
      });
    }
    return new ConclaveError({
      category: 'setup',
      code: 'SETUP-4',
      title: `${provider.label} has no remaining quota`,
      detail: 'This free tier is out of quota or credit for now.',
      recoveryActions: [ADD_PROVIDER, WAIT],
      canRetry: false,
    });
  }

  if (status === 404) {
    return new ConclaveError({
      category: 'provider',
      code: 'PROV-8',
      title: `Model not found on ${provider.label}`,
      detail: 'The requested model was removed or renamed. Falling back to an equivalent model.',
      recoveryActions: [DIFFERENT_MODEL, ADD_PROVIDER],
      canRetry: false,
      fallbackApplied: 'Routed to an equivalent model.',
    });
  }

  if (status === 429) {
    return new ConclaveError({
      category: 'provider',
      code: 'PROV-1',
      title: `${provider.label} is rate limited`,
      detail: 'Too many requests right now. The scheduler will back off and retry.',
      recoveryActions: [WAIT, ADD_PROVIDER],
      canRetry: true,
    });
  }

  if (status === 451) {
    return geoBlocked(provider);
  }

  if (status === 408) {
    return new ConclaveError({
      category: 'provider',
      code: 'PROV-4',
      title: `${provider.label} timed out`,
      detail: 'The provider reported a request timeout.',
      recoveryActions: [RETRY, ADD_PROVIDER],
      canRetry: true,
    });
  }

  if (status >= 500) {
    return new ConclaveError({
      category: 'provider',
      code: 'PROV-3',
      title: `${provider.label} is having an outage`,
      detail: `The provider returned a server error (${status}). Failing over.`,
      recoveryActions: [RETRY, ADD_PROVIDER],
      canRetry: true,
    });
  }

  if (status === 400 && /context length|maximum context|too long|too many tokens|reduce the length/.test(low)) {
    return new ConclaveError({
      category: 'provider',
      code: 'PROV-10',
      title: 'The request was too long for this model',
      detail: 'The conversation exceeds the model context window. It will be compacted or routed to a larger-context model.',
      recoveryActions: [{ label: 'Use a larger-context model', kind: 'switch' }],
      canRetry: false,
      fallbackApplied: 'Will compact context or route to a larger model.',
    });
  }

  return new ConclaveError({
    category: 'provider',
    code: 'PROV-3',
    title: `${provider.label} returned an error`,
    detail: `Unexpected HTTP ${status} from the provider.`,
    recoveryActions: [RETRY, ADD_PROVIDER],
    canRetry: true,
  });
}

export function emptyResponseError(provider: Provider): ConclaveError {
  return new ConclaveError({
    category: 'provider',
    code: 'PROV-6',
    title: `${provider.label} returned an empty response`,
    detail: 'The model produced no content. Retrying or failing over.',
    recoveryActions: [RETRY, ADD_PROVIDER],
    canRetry: true,
  });
}

export function malformedResponseError(provider: Provider, cause?: unknown): ConclaveError {
  return new ConclaveError({
    category: 'provider',
    code: 'PROV-5',
    title: `${provider.label} sent a malformed response`,
    detail: 'The response could not be parsed (truncated or invalid). Retrying or failing over.',
    cause,
    recoveryActions: [RETRY, ADD_PROVIDER],
    canRetry: true,
  });
}

export function refusalError(provider: Provider): ConclaveError {
  return new ConclaveError({
    category: 'provider',
    code: 'PROV-9',
    title: `${provider.label} refused the request`,
    detail: 'A safety filter blocked legitimate code work. Retrying with a different model.',
    recoveryActions: [DIFFERENT_MODEL, RETRY],
    canRetry: true,
  });
}

export function streamDroppedError(provider: Provider): ConclaveError {
  return new ConclaveError({
    category: 'provider',
    code: 'PROV-12',
    title: `${provider.label} dropped the stream`,
    detail: 'The streamed response ended before completion. No partial result was committed; retrying.',
    recoveryActions: [RETRY, ADD_PROVIDER],
    canRetry: true,
  });
}

export function missingKeyError(provider: Provider): ConclaveError {
  return new ConclaveError({
    category: 'setup',
    code: 'SETUP-1',
    title: `No API key for ${provider.label}`,
    detail: 'Add a key to use this provider.',
    recoveryActions: [{ label: 'Add key', kind: 'add', command: 'conclave.manageKeys' }],
    canRetry: false,
  });
}

function geoBlocked(provider: Provider): ConclaveError {
  return new ConclaveError({
    category: 'provider',
    code: 'SETUP-10',
    title: `${provider.label} is not available in your region`,
    detail: 'This provider is geo-blocked here. Use a different provider.',
    recoveryActions: [ADD_PROVIDER],
    canRetry: false,
  });
}
