/**
 * Server-side view of the shipped string catalogue.
 *
 * Re-exported from `@monopos/shared` so there is exactly one authoritative
 * copy: the server seeds new languages from it, serves it to the translation
 * editor as the English baseline, and compares against it to decide whether an
 * override counts as a genuine customisation.
 */
export { EN, missingKeys } from '@monopos/shared';
