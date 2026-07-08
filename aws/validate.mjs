// Server-side validation for feature-request tickets. This is the source of
// truth — the client (index.html) mirrors these same rules for instant
// feedback, but only this module's checks are actually trusted.
//
// Sanitize-not-whitelist policy: any printable characters are accepted
// (any language, any punctuation). Control characters are stripped (except
// newlines in the description) and length limits enforced. XSS is prevented
// at render time — every consumer must HTML-escape on output (index.html
// does, via escapeHtml) — and storage is DynamoDB/JSON with parameterized
// writes, so there is no SQL to inject into.

const SUBJECT_MAX = 150;
const DESCRIPTION_MAX = 2000;

// Strips C0/C1 control chars; keepNewlines preserves \n (and normalizes \r\n).
function sanitize(s, { keepNewlines = false } = {}) {
  const normalized = keepNewlines ? s.replace(/\r\n?/g, '\n') : s;
  const re = keepNewlines
    ? /[\x00-\x09\x0B-\x1F\x7F-\x9F]/g
    : /[\x00-\x1F\x7F-\x9F]/g;
  return normalized.replace(re, '').trim();
}

export function validateTicket(input) {
  const errors = [];
  const subject = typeof input?.subject === 'string' ? sanitize(input.subject) : '';
  const description = typeof input?.description === 'string'
    ? sanitize(input.description, { keepNewlines: true }) : '';

  if (!subject) errors.push('Subject is required.');
  else if (subject.length > SUBJECT_MAX) errors.push(`Subject must be ${SUBJECT_MAX} characters or fewer.`);

  if (!description) errors.push('Description is required.');
  else if (description.length > DESCRIPTION_MAX) errors.push(`Description must be ${DESCRIPTION_MAX} characters or fewer.`);

  return { valid: errors.length === 0, errors, value: { subject, description } };
}

export function validateStatus(status, allowedStatuses) {
  if (typeof status !== 'string' || !allowedStatuses.includes(status)) {
    return { valid: false, errors: [`Status must be one of: ${allowedStatuses.join(', ')}`] };
  }
  return { valid: true, errors: [], value: status };
}
