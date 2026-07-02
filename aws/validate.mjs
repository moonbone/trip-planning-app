// Server-side validation for feature-request tickets. This is the source of
// truth — the client (index.html) mirrors these same rules for instant
// feedback, but only this module's checks are actually trusted.
//
// Whitelist policy: English letters, digits, space, and . , - @ only. No
// other punctuation, no non-English characters, no HTML metacharacters.
// Rejecting disallowed input (rather than stripping it) keeps behavior
// predictable and avoids silently mangling what the user typed.

const LINE_CHARS = /^[A-Za-z0-9.,\- @]*$/;
const TEXT_CHARS = /^[A-Za-z0-9.,\- @\r\n]*$/;
const EMAIL_RE = /^[A-Za-z0-9.-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

const SUBJECT_MAX = 150;
const DESCRIPTION_MAX = 2000;
const EMAIL_MAX = 254;

export function validateTicket(input) {
  const errors = [];
  const subject = typeof input?.subject === 'string' ? input.subject.trim() : '';
  const description = typeof input?.description === 'string' ? input.description.trim() : '';
  const email = typeof input?.email === 'string' ? input.email.trim() : '';

  if (!subject) errors.push('Subject is required.');
  else if (subject.length > SUBJECT_MAX) errors.push(`Subject must be ${SUBJECT_MAX} characters or fewer.`);
  else if (!LINE_CHARS.test(subject)) errors.push('Subject may only contain English letters, numbers, spaces, and . , - @');

  if (!description) errors.push('Description is required.');
  else if (description.length > DESCRIPTION_MAX) errors.push(`Description must be ${DESCRIPTION_MAX} characters or fewer.`);
  else if (!TEXT_CHARS.test(description)) errors.push('Description may only contain English letters, numbers, spaces, line breaks, and . , - @');

  if (!email) errors.push('Email is required.');
  else if (email.length > EMAIL_MAX) errors.push(`Email must be ${EMAIL_MAX} characters or fewer.`);
  else if (!EMAIL_RE.test(email)) errors.push('Email must be a valid address using only English letters, numbers, . - @');

  return { valid: errors.length === 0, errors, value: { subject, description, email } };
}

export function validateStatus(status, allowedStatuses) {
  if (typeof status !== 'string' || !allowedStatuses.includes(status)) {
    return { valid: false, errors: [`Status must be one of: ${allowedStatuses.join(', ')}`] };
  }
  return { valid: true, errors: [], value: status };
}
