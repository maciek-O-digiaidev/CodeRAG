# Test Fixture App

This is a small fixture application used for integration testing of the CodeRAG pipeline.

## Structure

The fixture contains the following modules:

- **auth-service.ts** -- Authentication service with login, logout, and token validation
- **user-types.ts** -- TypeScript interfaces for User, AuthToken, and related types
- **utils.ts** -- Utility functions for hashing, ID generation, and debouncing
- **config.ts** -- Application configuration constants
- **api-routes.ts** -- API route handlers for user registration and health check
- **validators.ts** -- Input validation functions for email, password, and pagination

## Purpose

These files exercise different TypeScript constructs:

- Classes with methods (AuthService)
- Interfaces and type aliases (User, UserRole, AuthToken)
- Standalone functions (hashPassword, clamp, debounce)
- Constants and configuration objects (APP_NAME, SESSION_CONFIG)
- Import/export patterns (api-routes re-exports)
- Validation utilities (isValidEmail, isStrongPassword)
