<?php
declare(strict_types=1);

/**
 * CSRF protection for API endpoints.
 *
 * Strategy: Double-submit cookie pattern.
 *   1. On GET /api/me.php the token is included in the JSON response.
 *   2. Every mutating request (POST/PUT/DELETE) must send the token in
 *      the X-CSRF-Token header.
 *   3. The server compares the header value against the session-stored token
 *      using a constant-time comparison to prevent timing attacks.
 *
 * Desktop (Electron) context:
 *   All requests originate from http://127.0.0.1:8000 — a same-origin
 *   context — so CSRF is low-risk, but we enforce it anyway because:
 *   a) webSecurity is now re-enabled, and
 *   b) the web version is also served over a real network in some setups.
 */

require_once __DIR__ . '/session.php';

const CSRF_TOKEN_LENGTH = 32; // bytes → 64 hex chars

/**
 * Return the current session CSRF token, generating one if it doesn't exist yet.
 */
function get_csrf_token(): string
{
    start_secure_session();
    if (empty($_SESSION['csrf_token'])) {
        $_SESSION['csrf_token'] = bin2hex(random_bytes(CSRF_TOKEN_LENGTH));
    }
    return $_SESSION['csrf_token'];
}

/**
 * Regenerate the CSRF token (call after login to bind token to new session).
 */
function regenerate_csrf_token(): string
{
    start_secure_session();
    $_SESSION['csrf_token'] = bin2hex(random_bytes(CSRF_TOKEN_LENGTH));
    return $_SESSION['csrf_token'];
}

/**
 * Verify the CSRF token sent in the X-CSRF-Token request header.
 * Exits with 403 if the token is missing or doesn't match.
 *
 * Only enforced for state-changing methods (POST, PUT, DELETE, PATCH).
 * GET and HEAD are always allowed (they must be read-only).
 */
function verify_csrf_token(): void
{
    $method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
    if (in_array($method, ['GET', 'HEAD', 'OPTIONS'], true)) {
        return; // safe methods — no token needed
    }

    start_secure_session();
    $sessionToken = $_SESSION['csrf_token'] ?? '';
    $headerToken  = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';

    if ($sessionToken === '' || $headerToken === '') {
        http_response_code(403);
        header('Content-Type: application/json');
        echo json_encode(['error' => 'csrf_missing', 'message' => 'CSRF token missing']);
        exit;
    }

    if (!hash_equals($sessionToken, $headerToken)) {
        http_response_code(403);
        header('Content-Type: application/json');
        echo json_encode(['error' => 'csrf_invalid', 'message' => 'CSRF token invalid']);
        exit;
    }
}
