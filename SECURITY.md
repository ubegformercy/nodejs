# Security

**Report vulnerabilities privately to the maintainer. Do not create public GitHub issues for security bugs.**

## Best Practices

- Store all credentials in environment variables, never in code
- Use `.env` files for local development only (in `.gitignore`)
- Keep dependencies updated (`npm audit`)
- Rotate credentials periodically

## Deployment

- Use your deployment platform's secure variables system
- Never hardcode credentials
- Enable two-factor authentication on your accounts
- Review access permissions regularly
