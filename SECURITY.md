# Security Policy

PII Shield handles privacy-sensitive text in the browser, so security reports
should avoid including real personal data, customer data, secrets, or live
production prompts.

## Supported Versions

Security fixes are applied to the latest version on `main` and to the latest
published release package when a release package exists.

## Reporting A Vulnerability

If GitHub private vulnerability reporting is enabled for this repository, please
use it for security issues.

If private reporting is not available, open a minimal public issue that does not
include exploit details or sensitive sample data. Describe the affected area and
request a private coordination channel.

Useful report details:

- Extension version and commit SHA.
- Chrome version, operating system, and whether the issue affects Reversible
  Mode, Simple Mode, or both.
- Supported site where the issue was observed.
- Reproduction steps using synthetic data only.
- Expected behavior and actual behavior.

## Security-Sensitive Areas

Please report issues that affect:

- silent insertion of original PII after analysis failure;
- leakage of original PII or mapping values into the host page DOM;
- persistence of reversible mappings beyond their intended tab/session scope;
- unexpected network transmission of prompt text;
- overly broad host permissions or optional download permissions;
- bypasses in paste or copy interception on supported sites;
- unsafe handling of model output, malformed spans, or overlapping replacements.

## Privacy Review Notes

Developer-facing hardening notes are maintained in
[`docs/privacy-review-hardening-plan.md`](docs/privacy-review-hardening-plan.md).
