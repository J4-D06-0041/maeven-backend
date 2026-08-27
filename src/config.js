// Centralized, validated runtime configuration.
//
// Required secrets are checked once at require-time so a misconfigured
// deployment fails at boot instead of silently falling back to a well-known
// default that anyone reading this repository could forge tokens with.

const REQUIRED = ['JWT_SECRET'];

const missing = REQUIRED.filter((key) => !String(process.env[key] || '').trim());
if (missing.length) {
  console.error(
    `Refusing to start: missing required environment variable(s): ${missing.join(', ')}.\n` +
    'Set them in your environment (or .env) before starting the server.'
  );
  process.exit(1);
}

const jwtSecret = process.env.JWT_SECRET.trim();

// Reject the value that used to be hardcoded as a fallback — if it ever made it
// into a real environment it is public knowledge and must not be trusted.
if (jwtSecret === 'please-change-this-secret') {
  console.error(
    'Refusing to start: JWT_SECRET is set to the old hardcoded default. ' +
    'Generate a new secret (e.g. `openssl rand -base64 48`) and rotate it.'
  );
  process.exit(1);
}

if (jwtSecret.length < 32) {
  console.warn(
    `[config] JWT_SECRET is only ${jwtSecret.length} characters. ` +
    'Use at least 32 characters of high-entropy randomness.'
  );
}

module.exports = {
  jwtSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  isProduction: process.env.NODE_ENV === 'production',
  // Swagger UI and the raw spec are only exposed when explicitly enabled.
  exposeApiDocs: String(process.env.EXPOSE_API_DOCS || '').toLowerCase() === 'true',
};
