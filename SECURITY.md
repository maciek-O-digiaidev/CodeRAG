# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.x     | Yes       |

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly:

1. **Do NOT open a public issue**
2. Email security concerns to the project maintainers
3. Include a description of the vulnerability and steps to reproduce

We will acknowledge receipt within 48 hours and provide a detailed response within 7 days.

## Security Considerations

CodeRAG processes source code locally by default. When using cloud features:
- API keys are stored in local configuration only
- No source code is transmitted without explicit opt-in
- All API communications use HTTPS
