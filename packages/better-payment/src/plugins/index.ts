/**
 * better-payment/plugins: official plugins.
 */
// Classes come from the main entry point (kept external in the build), like in
// better-payment/testing, so that instanceof checks see the same classes.
export {
  i18n,
  locales,
  parseAcceptLanguage,
  type I18nOptions,
  type TranslationDictionary,
  type LocaleDetectionStrategy,
  // Deprecated names
  localizedErrors,
  errorMessages,
  type LocalizedErrorsOptions,
  type ErrorMessageDictionary,
} from './i18n';
export { chaos, type ChaosOptions, type ChaosRule } from './chaos';
// The fraud rules engine is the `better-payment/fraud` entry point: a rules and
// counter engine does not fit the gzip budget of this barrel, so importing
// `better-payment/plugins` stays free of it. Its types are here, because they
// describe the plugin you pass to `betterPayment()`.
export type {
  FraudRulesOptions,
  FraudVelocityRule,
  FraudRule,
  FraudRuleHit,
  FraudStore,
  FraudWindow,
  FraudDecision,
  FraudContext,
  FraudKeyKind,
  FraudMemberKind,
  FraudVerdict,
  FraudIpSource,
  FraudIpOptions,
} from './fraud-rules';
export {
  notifications,
  formatNotification,
  type NotificationsOptions,
  type NotificationChannel,
  type NotificationEvent,
  type NotificationLocale,
} from './notifications';
export { openAPI, buildOpenAPISpec, type OpenAPIOptions, type OpenAPISpec } from './openapi';
